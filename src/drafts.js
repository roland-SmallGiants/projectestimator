// Drafts replace the old single shared "live workspace". Each draft is an
// independent in-progress quote that anyone on the team can see, open, and
// continue — but only one person edits a given draft at a time, enforced by
// a soft lock (a heartbeat timestamp, not a hard database-level lock).
//
// Data model:
//   drafts/{id}          { clientName, projectDescription, disciplineMode,
//                           disciplines[], disciplineModeChosen,
//                           createdBy, createdAt,
//                           lockedBy, lockedAt (ISO string, refreshed while open) }
//   draft_items/{id}     { draftId, category, task, role, hours, qty, notes,
//                           defaultHours, hoursOverridden, excluded, custom }
//
// A lock is considered stale (and the draft editable again) if `lockedAt`
// is older than LOCK_TIMEOUT_MS. This is a deliberate, accepted trade-off:
// if someone's browser crashes mid-edit, the draft shows as locked for up
// to that timeout window even though nobody's really there. There is no
// clean way to detect "the other tab vanished" from a plain web page
// without a real backend session model, so a timeout is the practical fix.

import { db, nowTimestamp } from "./firebase-init.js";
import { state } from "./state.js";
import { esc, formatDateTime } from "./utils.js";
import { openConfirm } from "./modals.js";

const LOCK_TIMEOUT_MS = 2 * 60 * 1000; // 2 minutes
const HEARTBEAT_INTERVAL_MS = 30 * 1000;

let draftItemsUnsub = null;
let heartbeatTimer = null;

export function isLockStale(draft) {
  if (!draft.lockedAt) return true;
  return Date.now() - new Date(draft.lockedAt).getTime() > LOCK_TIMEOUT_MS;
}

export function lockOwner(draft) {
  if (!draft.lockedBy || isLockStale(draft)) return null;
  return draft.lockedBy;
}

export function subscribeDrafts(onChange) {
  return db.collection("drafts").onSnapshot((qs) => {
    state.drafts = {};
    qs.docs.forEach((d) => { state.drafts[d.id] = d.data(); });
    onChange();
  });
}

export function renderDraftsList() {
  const wrap = document.getElementById("draftsList");
  if (!wrap) return;
  const ids = Object.keys(state.drafts).sort((a, b) =>
    new Date(state.drafts[b].createdAt || 0) - new Date(state.drafts[a].createdAt || 0));

  if (!ids.length) {
    wrap.innerHTML = `<div class="task-empty">No drafts in progress. Start one below.</div>`;
    return;
  }

  wrap.innerHTML = ids.map((id) => {
    const d = state.drafts[id];
    const owner = lockOwner(d);
    const isMine = owner === state.currentUser;
    const statusText = owner
      ? (isMine ? "You have this open" : `${esc(owner)} is currently working on this`)
      : "Not currently open by anyone";
    return `<div class="draft-row" data-id="${id}" style="border:1px solid var(--line); border-radius:8px; padding:14px; margin-bottom:10px; display:flex; justify-content:space-between; align-items:center; gap:12px; flex-wrap:wrap;">
      <div>
        <div style="font-weight:600;">${esc(d.clientName || "(no client name)")}</div>
        <div class="sub" style="margin-top:2px;">${esc((d.disciplines || []).join(", ")) || "No scope set yet"} \u00b7 Started by ${esc(d.createdBy || "someone")}</div>
        <div class="sub" style="margin-top:2px; ${owner ? (isMine ? "color:var(--accent-ink);" : "color:var(--rose);") : ""}">${statusText}</div>
      </div>
      <div style="display:flex; gap:8px;">
        <button class="btn ${owner && !isMine ? "ghost" : "primary"} small draft-open-btn" data-id="${id}">${owner && !isMine ? "View (read-only)" : "Open"}</button>
        <button class="btn ghost small draft-delete-btn" data-id="${id}" style="color:var(--rose);">Delete</button>
      </div>
    </div>`;
  }).join("");

  wrap.querySelectorAll(".draft-open-btn").forEach((btn) => {
    btn.onclick = () => window.dispatchEvent(new CustomEvent("open-draft", { detail: { id: btn.dataset.id } }));
  });
  wrap.querySelectorAll(".draft-delete-btn").forEach((btn) => {
    btn.onclick = () => {
      const id = btn.dataset.id;
      const d = state.drafts[id];
      openConfirm(
        "Delete this draft?",
        `This permanently deletes the in-progress quote for "${d.clientName || "(no client name)"}" and all its tasks. This can't be undone.`,
        async () => {
          const items = await db.collection("draft_items").get();
          for (const doc of items.docs) {
            if (doc.data().draftId === id) await db.collection("draft_items").doc(doc.id).delete().catch(() => {});
          }
          await db.collection("drafts").doc(id).delete().catch(() => {});
        }
      );
    };
  });
}

export async function createDraft(clientName) {
  const ref = await db.collection("drafts").add({
    clientName: clientName || "",
    projectDescription: "",
    disciplineMode: "single",
    disciplines: [],
    disciplineModeChosen: false,
    createdBy: state.currentUser,
    createdAt: nowTimestamp(),
    lockedBy: null,
    lockedAt: null,
  });
  return ref.id;
}

// Returns true if the lock was acquired (or already held by this user).
export async function tryLockDraft(draftId) {
  const snap = await db.collection("drafts").doc(draftId).get();
  if (!snap.exists) return false;
  const d = snap.data();
  const owner = lockOwner(d);
  if (owner && owner !== state.currentUser) return false;
  await db.collection("drafts").doc(draftId).update({
    lockedBy: state.currentUser,
    lockedAt: nowTimestamp(),
  }).catch(() => {});
  return true;
}

export function startHeartbeat(draftId) {
  stopHeartbeat();
  heartbeatTimer = setInterval(() => {
    db.collection("drafts").doc(draftId).update({ lockedAt: nowTimestamp() }).catch(() => {});
  }, HEARTBEAT_INTERVAL_MS);
}

export function stopHeartbeat() {
  if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
}

export async function releaseLock(draftId) {
  stopHeartbeat();
  if (!draftId) return;
  const snap = await db.collection("drafts").doc(draftId).get().catch(() => null);
  if (snap && snap.exists && snap.data().lockedBy === state.currentUser) {
    await db.collection("drafts").doc(draftId).update({ lockedBy: null, lockedAt: null }).catch(() => {});
  }
}

export function subscribeDraftItems(draftId, onChange) {
  if (draftItemsUnsub) { draftItemsUnsub(); draftItemsUnsub = null; }
  draftItemsUnsub = db.collection("draft_items").onSnapshot((qs) => {
    state.draftItems = {};
    qs.docs.forEach((d) => {
      const data = d.data();
      if (data.draftId === draftId) state.draftItems[d.id] = data;
    });
    onChange();
  });
  return draftItemsUnsub;
}

export function unsubscribeDraftItems() {
  if (draftItemsUnsub) { draftItemsUnsub(); draftItemsUnsub = null; }
}

// Seeds draft_items for a discipline from the shared task catalog, skipping
// tasks that already exist in this draft (so re-adding a discipline that
// was previously removed doesn't duplicate work already in progress).
export async function seedDraftItemsForDiscipline(draftId, categoryName, taskCatalog) {
  const existing = new Set(
    Object.values(state.draftItems)
      .filter((it) => it.draftId === draftId && it.category === categoryName)
      .map((it) => it.task)
  );
  const tasks = Object.values(taskCatalog).filter((t) => t.category === categoryName);
  for (const t of tasks) {
    if (existing.has(t.task)) continue;
    await db.collection("draft_items").add({
      draftId, category: categoryName, task: t.task, role: "",
      hours: t.defaultHours || 0, qty: 1, notes: "",
      defaultHours: t.defaultHours || 0, hoursOverridden: false,
      excluded: false, custom: false, order: t.order ?? 0,
    }).catch(() => {});
  }
}
