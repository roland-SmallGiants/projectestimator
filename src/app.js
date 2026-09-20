import { db } from "./firebase-init.js";
import { state } from "./state.js";
import { ensureModalRoot, openConfirm } from "./modals.js";
import { initWelcomeScreen, renderWelcomeUserList, renderCurrentUserIndicator } from "./welcome.js";
import {
  subscribeDrafts, renderDraftsList, createDraft, tryLockDraft, startHeartbeat, releaseLock, subscribeDraftItems, unsubscribeDraftItems,
} from "./drafts.js";
import { renderEstimatorView, isReadOnly, wireClientNameAutocomplete, buildQuoteSnapshot } from "./estimator.js";
import { esc, money, wireAutocomplete } from "./utils.js";
import { subscribeQuotes, saveCurrentDraftAsQuote, buildArchiveRowHtml, wireArchiveRows } from "./quotes.js";
import { renderReport, wireChartToggle, wireHoursPerRoleSelect } from "./report.js";
import {
  subscribeAdminCatalogs, bootstrapDefaultsIfEmpty, renderAdminView, wireAddRole, wireAddDiscipline, wireTeamAdd,
} from "./admin.js";
import { setStatus, showView, wireNav, parseCurrentPath } from "./nav.js";

async function boot() {
  ensureModalRoot();

  // Wire up everything that only depends on local state/DOM first, so the
  // app is usable (welcome screen, nav, drafts shell) even if Firestore is
  // slow, unreachable, or firebase-config.js still has placeholder values.
  // Anything that needs the network happens after, and failures there are
  // surfaced as a status message instead of silently stalling the UI.
  initWelcomeScreen();
  wireNav();
  wireEstimatorActions();
  wireDraftsActions();
  wireChartToggle();
  wireHoursPerRoleSelect();
  wireAddRole();
  wireAddDiscipline();
  wireTeamAdd();
  wireClientNameAutocomplete();
  wireQuoteSearchAutocomplete();
  window.addEventListener("open-draft", (e) => openDraft(e.detail.id));
  window.addEventListener("beforeunload", () => { if (state.currentDraftId) releaseLock(state.currentDraftId); });
  window.addEventListener("popstate", () => routeFromUrl(false));

  bootstrapDefaultsIfEmpty().catch((e) => setStatus("Setup error: " + e.message + " — check src/firebase-config.js has your real project values.", true));

  db.doc("settings/main").onSnapshot((snap) => {
    if (snap.exists) state.settings = { ...state.settings, ...snap.data() };
    renderWelcomeUserList();
    renderCurrentUserIndicator();
    if (document.getElementById("adminView").style.display !== "none") renderAdminView();
    setStatus("Synced, shared live with your team.");
  }, (e) => setStatus("Sync error (settings): " + e.code + " — check src/firebase-config.js has your real project values.", true));

  subscribeAdminCatalogs(() => {
    if (state.currentDraftId) renderEstimatorView();
    if (document.getElementById("adminView").style.display !== "none") renderAdminView();
  });

  subscribeDrafts(() => {
    renderDraftsList();
    if (state.currentDraftId && !state.drafts[state.currentDraftId]) {
      // Someone else deleted or saved the draft we had open.
      state.currentDraftId = null;
      unsubscribeDraftItems();
      showView("drafts");
    } else if (state.currentDraftId) {
      renderEstimatorView();
    }
  });

  subscribeQuotes(() => {
    if (document.getElementById("quotesView").style.display !== "none") renderQuotesView();
    if (document.getElementById("reportView").style.display !== "none") renderReport();
  });

  routeFromUrl(true);
}

// Reads the current URL and shows the matching view. Used both for the very
// first load (isInitial: true, so it replaces history instead of pushing a
// redundant entry) and for browser back/forward navigation via popstate.
async function routeFromUrl(isInitial) {
  const { view, draftId } = parseCurrentPath();
  if (view === "estimator" && draftId) {
    await openDraft(draftId, { updateUrl: false });
  } else {
    if (state.currentDraftId) {
      await releaseLock(state.currentDraftId);
      state.currentDraftId = null;
      unsubscribeDraftItems();
    }
    showView(view, { updateUrl: isInitial, replace: isInitial });
  }
}

async function openDraft(id, options = {}) {
  if (state.currentDraftId && state.currentDraftId !== id) await releaseLock(state.currentDraftId);
  const locked = await tryLockDraft(id);
  state.currentDraftId = id;
  subscribeDraftItems(id, () => renderEstimatorView());
  if (locked) startHeartbeat(id);
  showView("estimator", { draftId: id, updateUrl: options.updateUrl !== false, replace: options.replace });
  renderEstimatorView();
}

function wireDraftsActions() {
  document.getElementById("newDraftBtn").onclick = async () => {
    const id = await createDraft("");
    openDraft(id);
  };
}

function wireEstimatorActions() {
  document.getElementById("saveQuoteBtn").onclick = () => {
    if (isReadOnly()) return;
    const draft = state.drafts[state.currentDraftId];
    const errEl = document.getElementById("projectDescriptionError");
    if (!draft || !draft.projectDescription || !draft.projectDescription.trim()) {
      errEl.style.display = "block";
      const descInput = document.getElementById("projectDescriptionInput");
      descInput.focus();
      descInput.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    errEl.style.display = "none";
    const isEditingExisting = draft && draft.sourceQuoteId && state.quotes[draft.sourceQuoteId];
    const snap = buildQuoteSnapshot();
    const summary = `
      <div style="border:1px solid var(--line); border-radius:8px; padding:10px 12px; margin-top:4px; font-size:13px;">
        <div><strong>${esc(snap.clientName)}</strong></div>
        <div class="sub" style="margin-top:2px;">${esc((snap.disciplines || []).join(", ")) || "No disciplines selected"}</div>
        <div style="margin-top:6px; display:flex; justify-content:space-between;">
          <span class="sub">${snap.grandHours.toLocaleString("nl-NL")} hrs \u00b7 ${snap.items.length} task${snap.items.length === 1 ? "" : "s"}</span>
          <strong>${money(snap.finalPrice)}</strong>
        </div>
      </div>`;
    openConfirm(
      isEditingExisting ? "Update this quote in the archive?" : "Save this quote to the archive?",
      (isEditingExisting
        ? "This updates the existing archived quote in place, stamped with today's edited date, and closes out this draft."
        : "This saves a read-only copy to the Quote Archive and closes out this draft.") + summary,
      async () => { await saveCurrentDraftAsQuote(); showView("drafts"); },
      "Yes",
      "primary"
    );
  };
  document.getElementById("closeDraftBtn").onclick = async () => {
    if (state.currentDraftId) await releaseLock(state.currentDraftId);
    unsubscribeDraftItems();
    state.currentDraftId = null;
    showView("drafts");
  };
  document.getElementById("discardDraftBtn").onclick = () => {
    if (isReadOnly()) return;
    const draftId = state.currentDraftId;
    const draft = state.drafts[draftId];
    openConfirm(
      "Discard this draft?",
      `This permanently deletes "${(draft && draft.clientName) || "(no client name)"}" and everything in it. This can't be undone.`,
      async () => {
        const items = await db.collection("draft_items").get();
        for (const doc of items.docs) {
          if (doc.data().draftId === draftId) await db.collection("draft_items").doc(doc.id).delete().catch(() => {});
        }
        await db.collection("drafts").doc(draftId).delete().catch(() => {});
        unsubscribeDraftItems();
        state.currentDraftId = null;
        showView("drafts");
      },
      "Yes, discard"
    );
  };
}

function knownQuoteClientNames() {
  const names = new Set();
  Object.values(state.quotes || {}).forEach((q) => {
    if (q.clientName && q.clientName !== "(no client name)") names.add(q.clientName);
  });
  return [...names];
}

function wireQuoteSearchAutocomplete() {
  const inputEl = document.getElementById("quoteSearchInput");
  const dropdownEl = document.getElementById("quoteSearchDropdown");
  if (!inputEl || !dropdownEl) return;
  wireAutocomplete(inputEl, dropdownEl, knownQuoteClientNames, (value) => {
    inputEl.value = value;
    renderQuotesView();
  });
}

function computeDateRangeCutoff(filterValue) {
  const now = new Date();
  let start = null, end = null;
  switch (filterValue) {
    case "7d": start = new Date(now); start.setDate(start.getDate() - 7); break;
    case "14d": start = new Date(now); start.setDate(start.getDate() - 14); break;
    case "1m": start = new Date(now); start.setMonth(start.getMonth() - 1); break;
    case "3m": start = new Date(now); start.setMonth(start.getMonth() - 3); break;
    case "ytd": start = new Date(now.getFullYear(), 0, 1); break;
    case "ly": start = new Date(now.getFullYear() - 1, 0, 1); end = new Date(now.getFullYear(), 0, 1); break;
    default: return null; // "all"
  }
  return { start, end };
}

function renderQuotesView() {
  const wrap = document.getElementById("quoteArchiveList");
  const query = (document.getElementById("quoteSearchInput").value || "").trim().toLowerCase();
  const dateFilter = document.getElementById("quoteDateFilter").value;
  const range = computeDateRangeCutoff(dateFilter);

  let ids = Object.keys(state.quotes).sort((a, b) => new Date(state.quotes[b].savedAt) - new Date(state.quotes[a].savedAt));
  if (query) ids = ids.filter((id) => (state.quotes[id].clientName || "").toLowerCase().includes(query));
  if (range) {
    ids = ids.filter((id) => {
      const saved = new Date(state.quotes[id].savedAt);
      return saved >= range.start && (!range.end || saved < range.end);
    });
  }

  const pendingIds = ids.filter((id) => state.quotes[id].status !== "won" && state.quotes[id].status !== "lost");
  const wonIds = ids.filter((id) => state.quotes[id].status === "won");
  const lostIds = ids.filter((id) => state.quotes[id].status === "lost");
  const wonTotal = wonIds.reduce((s, id) => s + (state.quotes[id].finalPrice || 0), 0);
  const lostTotal = lostIds.reduce((s, id) => s + (state.quotes[id].finalPrice || 0), 0);
  const decidedCount = wonIds.length + lostIds.length;
  const winRate = decidedCount ? Math.round((wonIds.length / decidedCount) * 100) : null;

  const archiveTableHeader = `<thead><tr>
    <th class="archive-th" style="width:24%">Client</th>
    <th class="archive-th" style="width:26%">Saved</th>
    <th class="archive-th">Description</th>
    <th class="archive-th archive-actions-col" style="width:170px"></th>
  </tr></thead>`;

  const activeTab = ["pending", "won", "lost"].includes(state.quoteListActiveTab) ? state.quoteListActiveTab : "pending";
  const activeIds = activeTab === "pending" ? pendingIds : activeTab === "won" ? wonIds : lostIds;

  const quotesSection = `<section class="card">
    <h2 style="font-size:15px;">Quotes</h2>
    <div class="sub">
      ${pendingIds.length} pending \u00b7 ${wonIds.length} won (${money(wonTotal)}) \u00b7 ${lostIds.length} lost (${money(lostTotal)})${winRate !== null ? ` \u00b7 ${winRate}% win rate` : ""}
    </div>
    <table class="cell-toggle" id="quoteListTabToggle" style="margin-top:14px;"><tr>
      <td class="${activeTab === "pending" ? "active" : ""}" data-tab="pending">Pending</td>
      <td class="${activeTab === "won" ? "active" : ""}" data-tab="won">Won</td>
      <td class="${activeTab === "lost" ? "active" : ""}" data-tab="lost">Lost</td>
    </tr></table>
    ${activeIds.length ? `<table class="archive-table" style="margin-top:10px;">
      ${archiveTableHeader}
      <tbody>${activeIds.map((id) => buildArchiveRowHtml(id)).join("")}</tbody>
    </table>` : `<div class="task-empty" style="margin-top:14px;">No ${activeTab} quotes here yet.</div>`}
  </section>`;

  wrap.innerHTML = quotesSection;
  wireArchiveRows(wrap, renderQuotesView);
  document.querySelectorAll("#quoteListTabToggle td").forEach((cell) => {
    cell.onclick = () => {
      state.quoteListActiveTab = cell.dataset.tab;
      renderQuotesView();
    };
  });
}
document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("quoteSearchInput").addEventListener("input", renderQuotesView);
  document.getElementById("quoteDateFilter").addEventListener("change", renderQuotesView);
});

window.__renderQuotesView = renderQuotesView;
window.__renderReport = renderReport;
window.__renderAdminView = renderAdminView;

boot();
