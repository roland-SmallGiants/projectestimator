import { db, nowTimestamp } from "./firebase-init.js";
import { state } from "./state.js";
import { esc, money, moneyPlain, formatDateTime, notesIcon } from "./utils.js";
import { openConfirm } from "./modals.js";
import { buildQuoteSnapshot } from "./estimator.js";
import { releaseLock, createDraft, tryLockDraft, startHeartbeat, seedDraftItemsForDiscipline } from "./drafts.js";

export function subscribeQuotes(onChange) {
  return db.collection("quotes").onSnapshot((qs) => {
    state.quotes = {};
    qs.docs.forEach((d) => { state.quotes[d.id] = d.data(); });
    onChange();
  });
}

export async function saveCurrentDraftAsQuote() {
  const snap = buildQuoteSnapshot();
  await db.collection("quotes").add({ ...snap, createdBy: state.currentUser });
  // Saving closes out the draft: release the lock and delete it plus its items.
  const draftId = state.currentDraftId;
  await releaseLock(draftId);
  const items = await db.collection("draft_items").get();
  for (const doc of items.docs) {
    if (doc.data().draftId === draftId) await db.collection("draft_items").doc(doc.id).delete().catch(() => {});
  }
  await db.collection("drafts").doc(draftId).delete().catch(() => {});
  state.currentDraftId = null;
}

export function buildArchiveRowHtml(id, embedOutcome) {
  const q = state.quotes[id];
  if (!q) return "";
  const dateStr = formatDateTime(q.savedAt);
  const editedStr = q.editedAt ? formatDateTime(q.editedAt) : "";
  const isOpen = state.openArchiveDetails.has(id);
  const isEditing = state.editingQuotes.has(id);

  const perCat = {};
  (q.items || []).forEach((it) => {
    perCat[it.category] = perCat[it.category] || { hours: 0, cost: 0 };
    perCat[it.category].hours += it.hours || 0;
    perCat[it.category].cost += it.cost || 0;
  });
  const catRows = (q.disciplines || []).map((c) => {
    const key = id + "::" + c;
    const catOpen = state.expandedArchiveCategories.has(key);
    const row = perCat[c] || { hours: 0, cost: 0 };
    const catRow = `<tr class="summary-cat-row archive-cat-row" data-key="${esc(key)}" style="cursor:pointer;">
      <td><span style="display:inline-block; width:14px;">${catOpen ? "\u25be" : "\u25b8"}</span>${esc(c)}</td>
      <td></td><td class="numc">${row.hours.toLocaleString("nl-NL")}</td><td class="num">${moneyPlain(row.cost)}</td>
    </tr>`;
    if (!catOpen) return catRow;
    const tasks = (q.items || []).filter((it) => it.category === c && it.role && (Number(it.hours) || 0) > 0);
    const taskRows = tasks.length ? tasks.map((it) => `<tr class="summary-task-row">
        <td style="padding-left:26px; font-size:12.5px; color:var(--ink-soft);">${esc(it.task)}${notesIcon(it.notes)}</td>
        <td style="font-size:12.5px; color:var(--ink-soft);">${esc(it.role)}</td>
        <td class="numc" style="font-size:12.5px; color:var(--ink-soft);">${(Number(it.hours) || 0).toLocaleString("nl-NL")}</td>
        <td class="num" style="font-size:12.5px; color:var(--ink-soft);">${moneyPlain(it.cost)}</td>
      </tr>`).join("") : `<tr class="summary-task-row"><td colspan="4" style="padding-left:26px; font-size:12.5px; color:var(--ink-soft);">No tasks with a role assigned yet.</td></tr>`;
    return catRow + taskRows;
  }).join("");

  const statusDateStr = (q.status === "won" || q.status === "lost") && q.statusChangedAt ? formatDateTime(q.statusChangedAt) : "";
  const outcomeChips = `<div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
    <div class="chips small">
      <button type="button" class="chip status-won ${q.status === "won" ? "on" : ""}" data-status="won">Won</button>
      <button type="button" class="chip status-lost ${q.status === "lost" ? "on" : ""}" data-status="lost">Lost</button>
    </div>
    ${embedOutcome && statusDateStr ? `<span class="sub">${q.status === "won" ? "Won" : "Lost"} on ${statusDateStr}</span>` : ""}
  </div>`;

  return `<div class="archive-row" data-id="${id}">
    <div class="archive-head">
      <div class="archive-collapse-toggle" style="cursor:pointer;">
        <div class="archive-meta-header-row"><span class="archive-meta-label">Client</span><span class="archive-meta-label">Saved</span><span class="archive-meta-label">Description</span></div>
        <div class="archive-meta-value-row">
          <span class="name"><span style="display:inline-block; width:14px;">${isOpen ? "\u25be" : "\u25b8"}</span>${esc(q.clientName)}</span>
          <span class="archive-meta-value">${dateStr}${q.createdBy ? ` by ${esc(q.createdBy)}` : ""}</span>
          <span class="archive-meta-value archive-meta-value-wrap">${esc(q.projectDescription || "") || "\u2014"}</span>
        </div>
      </div>
      <div style="display:flex; gap:10px; flex-wrap:wrap;">
        ${isOpen ? `<button class="btn ghost small archive-edit-toggle">${isEditing ? "Cancel" : "Edit"}</button>
        <button class="btn ghost small archive-delete" style="color:var(--rose);">Delete</button>` : ""}
      </div>
    </div>
    <div class="archive-detail ${isOpen ? "open" : ""}">
      ${editedStr ? `<div class="sub" style="margin-bottom:10px;">Edited ${editedStr}${q.editedBy ? ` by ${esc(q.editedBy)}` : ""}</div>` : ""}
      <table class="summary-style-table">
        <thead><tr><th>Category</th><th style="width:140px">Role</th><th class="numc" style="width:110px">Est. Hours</th><th class="num" style="width:120px">Est. Cost (\u20ac)</th></tr></thead>
        <tbody>${catRows}<tr class="summary-row final"><td>Final quoted price</td><td></td><td class="numc">${q.grandHours.toLocaleString("nl-NL")}</td><td class="num">${moneyPlain(q.finalPrice)}</td></tr></tbody>
      </table>
      ${!isEditing ? `<div class="row-actions" style="justify-content:${embedOutcome ? "space-between" : "flex-start"}; margin-top:14px;">
        <div style="display:flex; gap:10px;"><button class="btn ghost small archive-load-estimator">Continue in Estimator</button></div>
        ${embedOutcome ? outcomeChips : ""}
      </div>` : ""}
    </div>
  </div>${embedOutcome ? "" : `<div class="archive-status-block" data-id="${id}"><span class="sub">Outcome</span>${outcomeChips}</div>`}`;
}

export function wireArchiveRows(wrap, rerender) {
  wrap.querySelectorAll(".archive-collapse-toggle").forEach((el) => {
    el.onclick = () => {
      const rowId = el.closest(".archive-row").dataset.id;
      if (state.openArchiveDetails.has(rowId)) state.openArchiveDetails.delete(rowId);
      else state.openArchiveDetails.add(rowId);
      rerender();
    };
  });
  wrap.querySelectorAll(".archive-cat-row").forEach((tr) => {
    tr.onclick = () => {
      const key = tr.dataset.key;
      if (state.expandedArchiveCategories.has(key)) state.expandedArchiveCategories.delete(key);
      else state.expandedArchiveCategories.add(key);
      rerender();
    };
  });
  wrap.querySelectorAll(".archive-delete").forEach((btn) => {
    btn.onclick = () => {
      const id = btn.closest(".archive-row").dataset.id;
      openConfirm("Delete this quote?", "This permanently deletes the archived quote. This can't be undone.",
        async () => { await db.collection("quotes").doc(id).delete().catch(() => {}); });
    };
  });
  wrap.querySelectorAll(".status-won, .status-lost").forEach((btn) => {
    btn.onclick = async () => {
      const container = btn.closest(".archive-status-block") || btn.closest(".archive-row");
      const rowId = container.dataset.id;
      const newStatus = btn.dataset.status;
      const current = state.quotes[rowId] && state.quotes[rowId].status;
      const nextStatus = current === newStatus ? null : newStatus;
      await db.collection("quotes").doc(rowId).update({ status: nextStatus, statusChangedAt: nextStatus ? nowTimestamp() : null }).catch(() => {});
    };
  });
  wrap.querySelectorAll(".archive-load-estimator").forEach((btn) => {
    btn.onclick = () => {
      const id = btn.closest(".archive-row").dataset.id;
      openConfirm(
        "Continue this quote in the Estimator?",
        "This creates a new in-progress draft pre-filled with this quote's data, which you (and only you, while you're in it) can then edit. The original archived quote is left untouched until you save again.",
        async () => {
          const q = state.quotes[id];
          const draftId = await createDraft(q.clientName === "(no client name)" ? "" : q.clientName);
          await db.collection("drafts").doc(draftId).update({
            projectDescription: q.projectDescription || "",
            disciplineMode: q.disciplineMode || (q.disciplines.length > 1 ? "multiple" : "single"),
            disciplines: q.disciplines || [],
            disciplineModeChosen: true,
          });
          for (const item of q.items || []) {
            await db.collection("draft_items").add({
              draftId, category: item.category, task: item.task, role: item.role || "",
              hours: item.hours ?? 0, qty: item.qty ?? 1, notes: item.notes || "",
              defaultHours: 0, hoursOverridden: true, excluded: false, custom: true,
            });
          }
          await tryLockDraft(draftId);
          startHeartbeat(draftId);
          state.currentDraftId = draftId;
          window.dispatchEvent(new CustomEvent("open-draft", { detail: { id: draftId } }));
        },
        "Yes, create draft"
      );
    };
  });
}

export function handleExportQuoteCsv(id) {
  const q = state.quotes[id];
  if (!q) return;
  const rows = [["Category", "Task", "Role", "Hours", "Qty", "Cost", "Notes"]];
  (q.items || []).forEach((it) => rows.push([it.category, it.task, it.role, it.hours, it.qty, it.cost.toFixed(2), it.notes || ""]));
  rows.push(["", "", "", "", "Final quoted price", q.finalPrice.toFixed(2), ""]);
  const csv = rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${q.clientName || "quote"}.csv`;
  a.click();
}
