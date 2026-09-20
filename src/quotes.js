import { db, nowTimestamp } from "./firebase-init.js";
import { state } from "./state.js";
import { esc, money, moneyPlain, formatDateTime, formatDate, notesIcon } from "./utils.js";
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

function summarizeQuoteChanges(oldQ, newSnap) {
  const changes = [];
  if ((oldQ.clientName || "") !== (newSnap.clientName || "")) changes.push("changed client name");
  if ((oldQ.projectDescription || "") !== (newSnap.projectDescription || "")) changes.push("updated project description");

  const oldDisciplines = new Set(oldQ.disciplines || []);
  const newDisciplines = new Set(newSnap.disciplines || []);
  const added = [...newDisciplines].filter((d) => !oldDisciplines.has(d));
  const removed = [...oldDisciplines].filter((d) => !newDisciplines.has(d));
  if (added.length) changes.push(`added ${added.join(", ")}`);
  if (removed.length) changes.push(`removed ${removed.join(", ")}`);

  const oldByKey = {};
  (oldQ.items || []).forEach((it) => { oldByKey[`${it.category}::${it.task}`] = it; });
  const newByKey = {};
  (newSnap.items || []).forEach((it) => { newByKey[`${it.category}::${it.task}`] = it; });

  let addedTasks = 0, removedTasks = 0, hoursChanged = 0, roleChanged = 0, notesChanged = 0;
  Object.keys(newByKey).forEach((key) => {
    const oldIt = oldByKey[key];
    const newIt = newByKey[key];
    if (!oldIt) { addedTasks++; return; }
    if ((oldIt.hours || 0) !== (newIt.hours || 0)) hoursChanged++;
    if ((oldIt.role || "") !== (newIt.role || "")) roleChanged++;
    if ((oldIt.notes || "") !== (newIt.notes || "")) notesChanged++;
  });
  Object.keys(oldByKey).forEach((key) => { if (!newByKey[key]) removedTasks++; });

  if (addedTasks) changes.push(`added ${addedTasks} task${addedTasks === 1 ? "" : "s"}`);
  if (removedTasks) changes.push(`removed ${removedTasks} task${removedTasks === 1 ? "" : "s"}`);
  if (hoursChanged) changes.push(`updated hours for ${hoursChanged} task${hoursChanged === 1 ? "" : "s"}`);
  if (roleChanged) changes.push(`changed role${roleChanged === 1 ? "" : "s"} for ${roleChanged} task${roleChanged === 1 ? "" : "s"}`);
  if (notesChanged) changes.push(`updated notes for ${notesChanged} task${notesChanged === 1 ? "" : "s"}`);

  if (!changes.length) return "No changes detected";
  const joined = changes.join(", ");
  return joined.charAt(0).toUpperCase() + joined.slice(1);
}

export async function saveCurrentDraftAsQuote() {
  const snap = buildQuoteSnapshot();
  const draftId = state.currentDraftId;
  const draft = state.drafts[draftId];
  const sourceQuoteId = draft && draft.sourceQuoteId;

  if (sourceQuoteId && state.quotes[sourceQuoteId]) {
    // This draft came from "Continue in Estimator" on an existing quote:
    // update that quote in place (keeping its original savedAt/createdBy/
    // status), append to its edit history, rather than creating a duplicate.
    const oldQ = state.quotes[sourceQuoteId];
    const { savedAt, ...snapWithoutSavedAt } = snap;
    const newEntry = {
      editedAt: nowTimestamp(),
      editedBy: state.currentUser,
      changeSummary: summarizeQuoteChanges(oldQ, snap),
    };
    const editHistory = [...(oldQ.editHistory || []), newEntry];
    await db.collection("quotes").doc(sourceQuoteId).update({
      ...snapWithoutSavedAt,
      editedAt: newEntry.editedAt,
      editedBy: newEntry.editedBy,
      editHistory,
    }).catch(() => {});
  } else {
    await db.collection("quotes").add({ ...snap, createdBy: state.currentUser });
  }

  // Saving closes out the draft either way: release the lock and delete it plus its items.
  await releaseLock(draftId);
  const items = await db.collection("draft_items").get();
  for (const doc of items.docs) {
    if (doc.data().draftId === draftId) await db.collection("draft_items").doc(doc.id).delete().catch(() => {});
  }
  await db.collection("drafts").doc(draftId).delete().catch(() => {});
  state.currentDraftId = null;
}

function buildEditTimelineHtml(q, id) {
  // Back-compat: quotes edited before editHistory existed only have a single
  // editedAt/editedBy pair and no changeSummary.
  const history = Array.isArray(q.editHistory) && q.editHistory.length
    ? q.editHistory
    : (q.editedAt ? [{ editedAt: q.editedAt, editedBy: q.editedBy, changeSummary: null }] : []);
  if (!history.length) return "";

  const sorted = [...history].sort((a, b) => new Date(b.editedAt) - new Date(a.editedAt));
  const [latest, ...older] = sorted;
  const isOpen = state.expandedEditHistory.has(id);

  const itemHtml = (e) => `<div class="edit-timeline-item"><strong>${esc(e.editedBy || "Unknown")}</strong> \u2014 ${formatDateTime(e.editedAt)}${e.changeSummary ? ` <span class="sub">\u00b7</span> <span class="change-summary">${esc(e.changeSummary)}</span>` : ""}</div>`;

  return `<div class="edit-timeline">
    <div class="edit-timeline-item">
      <strong>${esc(latest.editedBy || "Unknown")}</strong> \u2014 ${formatDateTime(latest.editedAt)}${latest.changeSummary ? ` <span class="sub">\u00b7</span> <span class="change-summary">${esc(latest.changeSummary)}</span>` : ""}
      ${older.length ? `<a href="#" class="history-link archive-history-toggle" data-id="${id}">${isOpen ? "Hide history" : `View history (${older.length + 1})`}</a>` : ""}
    </div>
    ${older.length ? `<div class="edit-timeline-older ${isOpen ? "open" : ""}">${older.map(itemHtml).join("")}</div>` : ""}
  </div>`;
}

export function buildArchiveRowHtml(id) {
  const q = state.quotes[id];
  if (!q) return "";
  const dateStr = formatDateTime(q.savedAt);
  const isOpen = state.openArchiveDetails.has(id);

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

  const statusDateStr = (q.status === "won" || q.status === "lost") && q.statusChangedAt ? formatDate(q.statusChangedAt) : "";
  const outcomeChips = `<span style="display:inline-flex; align-items:center; gap:8px; flex-wrap:wrap;">
    <span class="archive-chips">
      ${q.status !== "lost" ? `<button type="button" class="archive-chip status-won ${q.status === "won" ? "on" : ""}" data-status="won">Won</button>` : ""}
      ${q.status !== "won" ? `<button type="button" class="archive-chip status-lost ${q.status === "lost" ? "on" : ""}" data-status="lost">Lost</button>` : ""}
    </span>
    ${statusDateStr ? `<span class="sub">on ${statusDateStr}</span>` : ""}
  </span>`;

  const openClass = isOpen ? "archive-row-open" : "";
  const mainRow = `<tr class="archive-row ${openClass}" data-id="${id}">
    <td>
      <div class="archive-name-cell archive-collapse-toggle" style="cursor:pointer;">
        <span class="archive-chevron">${isOpen ? "\u25be" : "\u25b8"}</span>
        <span class="archive-name">${esc(q.clientName)}</span>
      </div>
    </td>
    <td class="archive-value">${dateStr}</td>
    <td class="archive-value">${q.createdBy ? esc(q.createdBy) : "\u2014"}</td>
    <td class="archive-value">${esc(q.projectDescription || "") || "\u2014"}</td>
    <td class="archive-actions-col">
      ${(!isOpen || q.status === "won" || q.status === "lost") ? outcomeChips : ""}
      ${isOpen && q.status !== "won" && q.status !== "lost" ? `<span style="display:inline-flex; gap:10px;">
        <button class="btn ghost small archive-load-estimator">Edit</button>
        <button class="btn ghost small archive-delete" style="color:var(--rose);">Delete</button>
      </span>` : ""}
      ${isOpen && q.status === "won" ? (
        q.productiveSyncedAt
          ? `<span class="sub">Sent to Productive on ${formatDateTime(q.productiveSyncedAt)}</span>`
          : `<button class="btn ghost small send-to-productive">Send to Productive</button>`
      ) : ""}
    </td>
  </tr>`;

  const detailRow = isOpen ? `<tr class="archive-detail-row ${openClass}">
    <td colspan="5">
      ${buildEditTimelineHtml(q, id)}
      <table class="summary-style-table">
        <thead><tr><th>Category</th><th style="width:140px">Role</th><th class="numc" style="width:110px">Est. Hours</th><th class="num" style="width:120px">Est. Cost (\u20ac)</th></tr></thead>
        <tbody>${catRows}<tr class="summary-row final"><td>Final quoted price</td><td></td><td class="numc">${q.grandHours.toLocaleString("nl-NL")}</td><td class="num">${moneyPlain(q.finalPrice)}</td></tr></tbody>
      </table>
    </td>
  </tr>` : "";

  return mainRow + detailRow;
}

export function wireArchiveRows(wrap, rerender) {
  wrap.querySelectorAll(".send-to-productive").forEach((btn) => {
    btn.onclick = () => {
      const id = btn.closest(".archive-row").dataset.id;
      const q = state.quotes[id];
      if (!q) return;
      const validItems = q.items.filter((it) => it.role && (Number(it.hours) || 0) > 0);
      if (!validItems.length) {
        alert("This quote has no tasks with a role assigned, so there's nothing to send to Productive. Assign roles to its tasks first (via Edit) if you want to send it.");
        return;
      }
      openConfirm(
        "Send this quote's tasks to Productive?",
        `This creates ${validItems.length} task(s) in Productive, one per line item, for "${esc(q.clientName)}". This can't be undone from here \u2014 duplicate tasks would need to be removed in Productive directly.`,
        async () => {
          const items = validItems;
          try {
            const res = await fetch("/api/productive/create-tasks", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ quoteId: id, clientName: q.clientName, projectDescription: q.projectDescription, items }),
            });
            const data = await res.json().catch(() => ({}));
            if (res.ok && data.ok) {
              await db.collection("quotes").doc(id).update({ productiveSyncedAt: nowTimestamp() }).catch(() => {});
            } else if (data.results) {
              const failed = data.results.filter((r) => !r.ok);
              const summary = failed.length
                ? failed.map((r) => `${r.task}: ${r.error}`).join("\n")
                : "No tasks were created.";
              alert(`Sending to Productive failed for ${failed.length} of ${data.results.length} task(s):\n\n${summary}`);
            } else {
              alert("Sending to Productive failed: " + (data.error || `HTTP ${res.status}`));
            }
          } catch (err) {
            alert("Couldn't reach the Productive bridge service: " + err.message);
          }
        },
        "Send"
      );
    };
  });
  wrap.querySelectorAll(".archive-collapse-toggle").forEach((el) => {
    el.onclick = () => {
      const rowId = el.closest(".archive-row").dataset.id;
      const wasOpen = state.openArchiveDetails.has(rowId);
      const q = state.quotes[rowId];
      const isDecided = q && (q.status === "won" || q.status === "lost");

      if (!wasOpen) {
        // Accordion behavior: opening a quote closes any other open quote in
        // the same section (Pending vs Won/Lost), but the two sections track
        // their own open quote independently of each other.
        [...state.openArchiveDetails].forEach((openId) => {
          const openQ = state.quotes[openId];
          const openIsDecided = openQ && (openQ.status === "won" || openQ.status === "lost");
          if (openIsDecided === isDecided) state.openArchiveDetails.delete(openId);
        });
        state.openArchiveDetails.add(rowId);
      } else {
        state.openArchiveDetails.delete(rowId);
      }
      rerender();
    };
  });
  wrap.querySelectorAll(".archive-history-toggle").forEach((el) => {
    el.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      const id = el.dataset.id;
      if (state.expandedEditHistory.has(id)) state.expandedEditHistory.delete(id);
      else state.expandedEditHistory.add(id);
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
      const q = state.quotes[id];
      if (q && (q.status === "won" || q.status === "lost")) return; // Won/Lost quotes are locked from deletion.
      openConfirm("Delete this quote?", "This permanently deletes the archived quote. This can't be undone.",
        async () => { await db.collection("quotes").doc(id).delete().catch(() => {}); });
    };
  });
  wrap.querySelectorAll(".status-won, .status-lost").forEach((btn) => {
    btn.onclick = async () => {
      const rowId = btn.closest(".archive-row").dataset.id;
      const newStatus = btn.dataset.status;
      const current = state.quotes[rowId] && state.quotes[rowId].status;
      const nextStatus = current === newStatus ? null : newStatus;
      await db.collection("quotes").doc(rowId).update({ status: nextStatus, statusChangedAt: nextStatus ? nowTimestamp() : null }).catch(() => {});
    };
  });
  wrap.querySelectorAll(".archive-load-estimator").forEach((btn) => {
    btn.onclick = () => {
      const id = btn.closest(".archive-row").dataset.id;
      const q = state.quotes[id];
      if (q && (q.status === "won" || q.status === "lost")) return; // Won/Lost quotes are locked from further edits.
      openConfirm(
        "Continue this quote in the Estimator?",
        "This opens the quote as an in-progress draft so you (and only you, while you're in it) can keep editing it. Saving it again will update this same archived quote in place \u2014 stamped as edited \u2014 rather than creating a new one.",
        async () => {
          const q = state.quotes[id];
          const draftId = await createDraft(q.clientName === "(no client name)" ? "" : q.clientName, id);
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
        "Confirm"
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
