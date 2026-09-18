// Admin-managed shared catalogs. Note the one structural change from the
// original artifact: `line_items` there conflated the admin-managed default
// task catalog with the live in-progress values. Since drafts now need their
// OWN independent copies of task values, the catalog is split out into its
// own `task_catalog` collection (admin-managed template), and each draft's
// `draft_items` are seeded from it. Editing the catalog here does not
// retroactively change values already sitting in someone's draft — same
// spirit as the original ("Applies to" / default-hours changes affect the
// catalog and future drafts, not in-flight work).

import { db } from "./firebase-init.js";
import { state, CATEGORIES } from "./state.js";
import { esc, moneyPlain } from "./utils.js";
import { openConfirm } from "./modals.js";

export function subscribeAdminCatalogs(onChange) {
  const unsubs = [
    db.collection("disciplines").onSnapshot((qs) => {
      state.disciplines = {};
      qs.docs.forEach((d) => { state.disciplines[d.id] = d.data(); });
      onChange();
    }),
    db.collection("rate_card").onSnapshot((qs) => {
      state.rateCard = {};
      qs.docs.forEach((d) => { state.rateCard[d.id] = d.data(); });
      onChange();
    }),
    db.collection("task_catalog").onSnapshot((qs) => {
      state.taskCatalog = {};
      qs.docs.forEach((d) => { state.taskCatalog[d.id] = d.data(); });
      onChange();
    }),
  ];
  return () => unsubs.forEach((u) => u());
}

export async function bootstrapDefaultsIfEmpty() {
  const discSnap = await db.collection("disciplines").get();
  if (discSnap.docs.length) return; // already seeded

  const defaults = ["Tracking Implementation", "Pipeline Migration", "Dashboard Build", "Data Audit", "AI & Analysis Pilot", "Other"];
  for (let i = 0; i < defaults.length; i++) {
    await db.collection("disciplines").add({ name: defaults[i], order: i });
  }
  const roles = [
    { role: "Tracking Specialist", rate: 115 },
    { role: "Analyst", rate: 115 },
    { role: "Engineer", rate: 125 },
    { role: "Lead", rate: 150 },
  ];
  for (let i = 0; i < roles.length; i++) {
    await db.collection("rate_card").add({ ...roles[i], order: i, categories: defaults });
  }
  const settingsSnap = await db.doc("settings/main").get();
  if (!settingsSnap.exists) {
    await db.doc("settings/main").set({ adminPin: "1234", contingencyPct: 0.15, knownUsers: ["Nick", "Desiree", "Roland"] });
  }
}

// ---- Rate Card ----

export function renderRateCard() {
  const body = document.getElementById("rateCardBody");
  if (!body) return;
  const ids = Object.keys(state.rateCard).sort((a, b) => (state.rateCard[a].order ?? 0) - (state.rateCard[b].order ?? 0));
  body.innerHTML = ids.map((id) => {
    const r = state.rateCard[id];
    return `<tr data-id="${id}">
      <td><input type="text" class="role-name" value="${esc(r.role)}"></td>
      <td class="numc"><input type="number" class="role-rate" value="${r.rate}" min="0" step="1"></td>
      <td><button class="btn small danger role-del">\u2715</button></td>
    </tr>`;
  }).join("") || `<tr><td colspan="3" style="color:var(--ink-soft); text-align:center; padding:16px;">No roles yet.</td></tr>`;

  body.querySelectorAll("tr[data-id]").forEach((tr) => {
    const id = tr.dataset.id;
    const nameInput = tr.querySelector(".role-name");
    const rateInput = tr.querySelector(".role-rate");
    nameInput.onchange = () => db.collection("rate_card").doc(id).update({ role: nameInput.value }).catch(() => {});
    rateInput.onchange = () => db.collection("rate_card").doc(id).update({ rate: Number(rateInput.value) || 0 }).catch(() => {});
    tr.querySelector(".role-del").onclick = () => {
      openConfirm(
        "Delete this role?",
        `This permanently deletes "${nameInput.value || "(unnamed role)"}" from the Rate Card. Any task currently assigned to this role will show as unassigned instead.`,
        async () => { await db.collection("rate_card").doc(id).delete().catch(() => {}); }
      );
    };
  });
}

export function wireAddRole() {
  document.getElementById("addRole").onclick = async () => {
    const ids = Object.keys(state.rateCard);
    const order = ids.length ? Math.max(...ids.map((id) => state.rateCard[id].order ?? 0)) + 1 : 0;
    await db.collection("rate_card").add({ role: "New role", rate: 100, order, categories: CATEGORIES() });
  };
}

// ---- Disciplines + task catalog ----

export function renderDisciplinesAdmin() {
  const list = document.getElementById("disciplinesList");
  if (!list) return;
  const ids = Object.keys(state.disciplines).sort((a, b) => (state.disciplines[a].order ?? 0) - (state.disciplines[b].order ?? 0));

  list.innerHTML = ids.map((id) => {
    const d = state.disciplines[id];
    const tasks = Object.entries(state.taskCatalog || {}).filter(([, t]) => t.category === d.name);
    return `<div class="discipline-row" data-id="${id}" style="border:1px solid var(--line); border-radius:8px; padding:14px; margin-bottom:12px;">
      <div style="display:flex; justify-content:space-between; align-items:center; gap:10px;">
        <input type="text" class="disc-name" value="${esc(d.name)}" style="font-weight:700; max-width:260px;">
        <button class="btn small danger disc-del">\u2715</button>
      </div>
      <div class="sub" style="margin-top:8px;">Default tasks</div>
      <ul style="list-style:none; padding:0; margin:6px 0;">
        ${tasks.map(([tid, t]) => `<li data-item-id="${tid}" style="display:flex; justify-content:space-between; align-items:center; padding:6px 0; border-bottom:1px solid var(--line);">
          <span>${esc(t.task)}</span>
          <span style="display:flex; align-items:center; gap:8px;">
            <span class="sub">Default hrs</span>
            <input type="number" class="task-default-hours" data-item-id="${tid}" value="${t.defaultHours || 0}" min="0" step="0.5" style="width:60px;">
            <button class="btn small danger disc-task-del" data-item-id="${tid}">\u2715</button>
          </span>
        </li>`).join("") || `<li class="sub">No tasks yet.</li>`}
      </ul>
      <div class="row-actions">
        <input type="text" class="new-task-name" placeholder="New task name" style="max-width:220px;">
        <button class="btn ghost small add-task-btn">+ Add</button>
      </div>
    </div>`;
  }).join("") || `<div class="task-empty">No disciplines yet.</div>`;

  list.querySelectorAll(".discipline-row").forEach((row) => {
    const id = row.dataset.id;
    const nameInput = row.querySelector(".disc-name");
    nameInput.onchange = () => renameDiscipline(id, nameInput.value);
    row.querySelector(".disc-del").onclick = () => openDeleteDisciplineConfirm(id);

    row.querySelectorAll(".task-default-hours").forEach((input) => {
      input.onchange = () => {
        db.collection("task_catalog").doc(input.dataset.itemId).update({ defaultHours: Number(input.value) || 0 }).catch(() => {});
      };
    });
    row.querySelectorAll(".disc-task-del").forEach((btn) => {
      btn.onclick = () => {
        const itemId = btn.dataset.itemId;
        const taskName = state.taskCatalog[itemId] ? state.taskCatalog[itemId].task : "(untitled task)";
        openConfirm(
          "Delete this task?",
          `This permanently removes "${taskName}" from ${state.disciplines[id] ? state.disciplines[id].name : "this discipline"}'s default task list. Drafts that already have it keep their own copy; it just won't be offered to new drafts.`,
          async () => { await db.collection("task_catalog").doc(itemId).delete().catch(() => {}); }
        );
      };
    });
    row.querySelector(".add-task-btn").onclick = async () => {
      const input = row.querySelector(".new-task-name");
      const name = input.value.trim();
      if (!name) return;
      await db.collection("task_catalog").add({ category: state.disciplines[id].name, task: name, defaultHours: 0 });
      input.value = "";
    };
  });
}

async function renameDiscipline(id, newName) {
  const oldName = state.disciplines[id].name;
  if (!newName || newName === oldName) return;
  await db.collection("disciplines").doc(id).update({ name: newName }).catch(() => {});
  // Cascade the rename so existing references keep pointing at the right category.
  const catalogSnap = await db.collection("task_catalog").get();
  for (const d of catalogSnap.docs) {
    if (d.data().category === oldName) await db.collection("task_catalog").doc(d.id).update({ category: newName }).catch(() => {});
  }
  const rateSnap = await db.collection("rate_card").get();
  for (const d of rateSnap.docs) {
    const cats = d.data().categories || [];
    if (cats.includes(oldName)) {
      await db.collection("rate_card").doc(d.id).update({ categories: cats.map((c) => (c === oldName ? newName : c)) }).catch(() => {});
    }
  }
}

let pendingDeleteDisciplineId = null;
export function openDeleteDisciplineConfirm(id) {
  const name = state.disciplines[id] && state.disciplines[id].name;
  if (!name) return;
  pendingDeleteDisciplineId = id;
  openConfirm(
    "Delete this discipline?",
    `This permanently deletes "${name}" from the shared catalog and removes it from any role's "Applies to" list. It will NOT remove it from drafts that already include it — those keep their existing tasks. This can't be undone.`,
    async () => {
      const catalogSnap = await db.collection("task_catalog").get();
      for (const d of catalogSnap.docs) {
        if (d.data().category === name) await db.collection("task_catalog").doc(d.id).delete().catch(() => {});
      }
      const rateSnap = await db.collection("rate_card").get();
      for (const d of rateSnap.docs) {
        const cats = d.data().categories || [];
        if (cats.includes(name)) await db.collection("rate_card").doc(d.id).update({ categories: cats.filter((c) => c !== name) }).catch(() => {});
      }
      await db.collection("disciplines").doc(id).delete().catch(() => {});
    }
  );
}

export function wireAddDiscipline() {
  document.getElementById("addDiscipline").onclick = async () => {
    const ids = Object.keys(state.disciplines);
    const order = ids.length ? Math.max(...ids.map((id) => state.disciplines[id].order ?? 0)) + 1 : 0;
    await db.collection("disciplines").add({ name: "New discipline", order });
  };
}

// ---- Pricing ----

export function renderPricingCard() {
  const input = document.getElementById("contingencyInput");
  if (!input) return;
  if (document.activeElement !== input) input.value = ((state.settings.contingencyPct ?? 0.15) * 100).toFixed(1);
  input.onchange = () => {
    const v = (Number(input.value) || 0) / 100;
    db.doc("settings/main").update({ contingencyPct: v }).catch(() => {});
  };
}

// ---- Team ----

export function renderTeamCard() {
  const list = document.getElementById("teamList");
  if (!list) return;
  const raw = (Array.isArray(state.settings.knownUsers) && state.settings.knownUsers.length)
    ? state.settings.knownUsers : ["Nick", "Desiree", "Roland"];
  const users = [...raw].sort((a, b) => (a === "Roland" ? 1 : b === "Roland" ? -1 : a.localeCompare(b)));
  list.innerHTML = users.map((u) => `<div class="chip" style="display:inline-flex; align-items:center; gap:8px; margin:0 8px 8px 0;">
    <span>${esc(u)}</span>
    ${u === "Roland" ? "" : `<button type="button" class="team-remove-btn" data-name="${esc(u)}" style="all:unset; cursor:pointer; color:var(--rose); font-weight:700;">\u2715</button>`}
  </div>`).join("");
  list.querySelectorAll(".team-remove-btn").forEach((btn) => {
    btn.onclick = () => {
      const name = btn.dataset.name;
      openConfirm(
        "Remove this person?",
        `"${name}" will no longer appear on the welcome screen. They can be added back later if needed.`,
        async () => {
          const updated = raw.filter((u) => u !== name);
          state.settings.knownUsers = updated;
          await db.doc("settings/main").update({ knownUsers: updated }).catch(() => {});
          renderTeamCard();
        }
      );
    };
  });
}

export function wireTeamAdd() {
  document.getElementById("teamNewPersonSubmit").onclick = async () => {
    const input = document.getElementById("teamNewPersonInput");
    const name = input.value.trim();
    if (!name) return;
    const current = (Array.isArray(state.settings.knownUsers) && state.settings.knownUsers.length)
      ? state.settings.knownUsers : ["Nick", "Desiree", "Roland"];
    if (!current.includes(name)) {
      const updated = [...current, name];
      state.settings.knownUsers = updated;
      await db.doc("settings/main").update({ knownUsers: updated }).catch(() => {});
      renderTeamCard();
    }
    input.value = "";
  };
}

export function renderAdminView() {
  renderRateCard();
  renderDisciplinesAdmin();
  renderPricingCard();
  renderTeamCard();
}
