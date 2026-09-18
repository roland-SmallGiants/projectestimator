import { db } from "./firebase-init.js";
import { state } from "./state.js";
import { ensureModalRoot, openConfirm } from "./modals.js";
import { initWelcomeScreen, renderWelcomeUserList, renderCurrentUserIndicator } from "./welcome.js";
import {
  subscribeDrafts, renderDraftsList, createDraft, tryLockDraft, startHeartbeat, releaseLock, subscribeDraftItems, unsubscribeDraftItems,
} from "./drafts.js";
import { renderEstimatorView, isReadOnly, renderClientNameOptions, buildQuoteSnapshot } from "./estimator.js";
import { esc, money } from "./utils.js";
import { subscribeQuotes, saveCurrentDraftAsQuote, buildArchiveRowHtml, wireArchiveRows } from "./quotes.js";
import { renderReport, wireChartToggle } from "./report.js";
import {
  subscribeAdminCatalogs, bootstrapDefaultsIfEmpty, renderAdminView, wireAddRole, wireAddDiscipline, wireTeamAdd,
} from "./admin.js";
import { setStatus, showView, wireNav } from "./nav.js";

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
  wireAddRole();
  wireAddDiscipline();
  wireTeamAdd();
  window.addEventListener("open-draft", (e) => openDraft(e.detail.id));
  window.addEventListener("beforeunload", () => { if (state.currentDraftId) releaseLock(state.currentDraftId); });

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
    renderClientNameOptions();
  });
}

async function openDraft(id) {
  if (state.currentDraftId && state.currentDraftId !== id) await releaseLock(state.currentDraftId);
  const locked = await tryLockDraft(id);
  state.currentDraftId = id;
  subscribeDraftItems(id, () => renderEstimatorView());
  if (locked) startHeartbeat(id);
  showView("estimator");
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

function renderQuotesView() {
  const wrap = document.getElementById("quoteArchiveList");
  const query = (document.getElementById("quoteSearchInput").value || "").trim().toLowerCase();
  let ids = Object.keys(state.quotes).sort((a, b) => new Date(state.quotes[b].savedAt) - new Date(state.quotes[a].savedAt));
  if (query) ids = ids.filter((id) => (state.quotes[id].clientName || "").toLowerCase().includes(query));
  wrap.innerHTML = ids.length ? ids.map((id) => buildArchiveRowHtml(id, false)).join("") : `<div class="task-empty">No quotes saved yet.</div>`;
  wireArchiveRows(wrap, renderQuotesView);
}
document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("quoteSearchInput").addEventListener("input", renderQuotesView);
});

window.__renderQuotesView = renderQuotesView;
window.__renderReport = renderReport;
window.__renderAdminView = renderAdminView;

boot();
