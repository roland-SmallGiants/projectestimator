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

  const tasksByCategory = {
    "Tracking Implementation": [
      ["Kickoff call & requirements gathering", 2],
      ["GTM container setup & configuration", 4],
      ["Event implementation (per platform)", 8],
      ["QA in GA4 DebugView", 4],
      ["Cross-browser / device testing", 3],
      ["Client review & sign-off", 2],
      ["Go-live support", 2],
      ["Post-launch monitoring (7 days)", 3],
    ],
    "Pipeline Migration": [
      ["Current state documentation", 4],
      ["Solution design (proposed state)", 6],
      ["Build & staging migration", 12],
      ["Data parity validation", 6],
      ["Rollback plan & testing", 3],
      ["Cutover execution", 4],
      ["Post-cutover monitoring", 3],
    ],
    "Dashboard Build": [
      ["Data source mapping", 3],
      ["Data modeling (SQL)", 8],
      ["Dashboard build", 12],
      ["Client review rounds", 4],
      ["QA & handoff", 3],
    ],
    "Data Audit": [
      ["Tracking coverage review", 4],
      ["Pipeline reliability review", 3],
      ["Cost center & vendor review", 3],
      ["Ownership & documentation review", 2],
      ["Access & permissions review", 2],
      ["Findings report & presentation", 4],
    ],
    "AI & Analysis Pilot": [
      ["Discovery & hypothesis definition", 4],
      ["Data readiness assessment", 4],
      ["Model / analysis build", 12],
      ["Validation", 4],
      ["Presentation of findings", 3],
    ],
    "Other": [],
  };
  const defaults = Object.keys(tasksByCategory);
  for (let i = 0; i < defaults.length; i++) {
    await db.collection("disciplines").add({ name: defaults[i], order: i });
  }
  const defaultRoleNames = ["Tracking Specialist", "Analyst", "Engineer", "Lead"];
  for (const [category, tasks] of Object.entries(tasksByCategory)) {
    for (let i = 0; i < tasks.length; i++) {
      const [task, hours] = tasks[i];
      const hoursByRole = {};
      defaultRoleNames.forEach((r) => { hoursByRole[r] = hours; });
      await db.collection("task_catalog").add({ category, task, hoursByRole, order: i });
    }
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

let draggedRoleId = null;

function wireRoleDragAndDrop(body) {
  if (!body) return;
  body.querySelectorAll(".role-drag-item").forEach((row) => {
    row.addEventListener("dragstart", () => {
      draggedRoleId = row.dataset.id;
      row.style.opacity = "0.4";
    });
    row.addEventListener("dragend", () => {
      row.style.opacity = "";
      draggedRoleId = null;
    });
    row.addEventListener("dragover", (e) => {
      e.preventDefault();
      if (!draggedRoleId || row.dataset.id === draggedRoleId) return;
      const draggedEl = body.querySelector(`[data-id="${draggedRoleId}"]`);
      if (!draggedEl) return;
      const rect = row.getBoundingClientRect();
      const before = (e.clientY - rect.top) < rect.height / 2;
      row.parentNode.insertBefore(draggedEl, before ? row : row.nextSibling);
    });
    row.addEventListener("drop", async (e) => {
      e.preventDefault();
      const ids = [...body.querySelectorAll(".role-drag-item")].map((r) => r.dataset.id);
      for (let i = 0; i < ids.length; i++) {
        if ((state.rateCard[ids[i]] || {}).order === i) continue;
        await db.collection("rate_card").doc(ids[i]).update({ order: i }).catch(() => {});
      }
    });
  });
}

export function renderRateCard() {
  const body = document.getElementById("rateCardBody");
  if (!body) return;
  const ids = Object.keys(state.rateCard).sort((a, b) => (state.rateCard[a].order ?? 0) - (state.rateCard[b].order ?? 0));
  const allCategories = CATEGORIES();

  body.innerHTML = ids.map((id) => {
    const r = state.rateCard[id];
    const cats = Array.isArray(r.categories) ? r.categories : [];
    const rows = `<div class="chips small role-cat-chips" data-id="${id}">
        ${allCategories.map((c) => `<button type="button" class="chip ${cats.includes(c) ? "on" : ""}" data-cat="${esc(c)}">${esc(c)}</button>`).join("")}
      </div>`;
    return `<tr class="role-drag-item" draggable="true" data-id="${id}">
      <td><span style="display:flex; align-items:center; gap:8px;"><span class="sub" style="cursor:grab; user-select:none;">\u283f</span><input type="text" class="role-name" value="${esc(r.role)}"></span></td>
      <td class="numc"><input type="number" class="role-rate" value="${r.rate}" min="0" step="1" style="text-align:right; width:calc(100% - 6px); margin-right:6px;"></td>
      <td>${rows}</td>
      <td><button class="btn small danger role-del">\u2715</button></td>
    </tr>`;
  }).join("") || `<tr><td colspan="4" style="color:var(--ink-soft); text-align:center; padding:16px;">No roles yet.</td></tr>`;

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
    tr.querySelectorAll(".role-cat-chips .chip").forEach((chip) => {
      chip.onclick = async () => {
        const r = state.rateCard[id];
        const current = Array.isArray(r.categories) ? r.categories : [];
        const cat = chip.dataset.cat;
        const next = current.includes(cat) ? current.filter((c) => c !== cat) : [...current, cat];
        await db.collection("rate_card").doc(id).update({ categories: next }).catch(() => {});
      };
    });
  });

  wireRoleDragAndDrop(body);
}

export function wireAddRole() {
  document.getElementById("addRole").onclick = async () => {
    const ids = Object.keys(state.rateCard);
    const order = ids.length ? Math.max(...ids.map((id) => state.rateCard[id].order ?? 0)) + 1 : 0;
    await db.collection("rate_card").add({ role: "New role", rate: 100, order, categories: CATEGORIES() });
  };
}

// ---- Disciplines + task catalog ----

let draggedTaskId = null;

function wireTaskDragAndDrop(listEl) {
  if (!listEl) return;
  listEl.querySelectorAll(".task-drag-item").forEach((li) => {
    li.addEventListener("dragstart", () => {
      draggedTaskId = li.dataset.itemId;
      li.style.opacity = "0.4";
    });
    li.addEventListener("dragend", () => {
      li.style.opacity = "";
      draggedTaskId = null;
    });
    li.addEventListener("dragover", (e) => {
      e.preventDefault();
      if (!draggedTaskId || li.dataset.itemId === draggedTaskId) return;
      const draggedEl = listEl.querySelector(`[data-item-id="${draggedTaskId}"]`);
      if (!draggedEl) return;
      const rect = li.getBoundingClientRect();
      const before = (e.clientY - rect.top) < rect.height / 2;
      li.parentNode.insertBefore(draggedEl, before ? li : li.nextSibling);
    });
    li.addEventListener("drop", async (e) => {
      e.preventDefault();
      await persistTaskOrder(listEl);
    });
  });
}

async function persistTaskOrder(listEl) {
  const ids = [...listEl.querySelectorAll(".task-drag-item")].map((li) => li.dataset.itemId);
  const itemsSnap = await db.collection("draft_items").get();
  for (let i = 0; i < ids.length; i++) {
    const tid = ids[i];
    const t = state.taskCatalog[tid];
    if (!t || t.order === i) continue;
    await db.collection("task_catalog").doc(tid).update({ order: i }).catch(() => {});
    for (const doc of itemsSnap.docs) {
      const it = doc.data();
      if (it.category === t.category && it.task === t.task) {
        await db.collection("draft_items").doc(doc.id).update({ order: i }).catch(() => {});
      }
    }
  }
}

export function getTaskHoursForRole(t, roleName) {
  if (t.hoursByRole && Object.prototype.hasOwnProperty.call(t.hoursByRole, roleName)) return t.hoursByRole[roleName];
  return t.defaultHours || 0; // fallback for tasks seeded before per-role hours existed
}

export function renderDisciplinesAdmin() {
  const list = document.getElementById("disciplinesList");
  if (!list) return;
  const ids = Object.keys(state.disciplines).sort((a, b) => (state.disciplines[a].order ?? 0) - (state.disciplines[b].order ?? 0));

  list.innerHTML = ids.map((id) => {
    const d = state.disciplines[id];
    const tasks = Object.entries(state.taskCatalog || {}).filter(([, t]) => t.category === d.name).sort((a, b) => (a[1].order ?? 0) - (b[1].order ?? 0));
    const applicableRoles = Object.values(state.rateCard)
      .filter((r) => r.role && (!Array.isArray(r.categories) || r.categories.length === 0 || r.categories.includes(d.name)))
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    const colCount = applicableRoles.length + 3;

    return `<div class="discipline-row" data-id="${id}" style="border:1px solid var(--line); border-radius:8px; padding:14px; margin-bottom:12px;">
      <div style="display:flex; justify-content:space-between; align-items:center; gap:10px;">
        <span style="display:flex; align-items:center; gap:8px;">
          <span class="disc-name-display" style="font-weight:700;">${esc(d.name)}</span>
          <input type="text" class="disc-name-input" value="${esc(d.name)}" style="display:none; font-weight:700; max-width:260px;">
          <button type="button" class="disc-name-edit-btn" title="Rename discipline" style="all:unset; cursor:pointer; color:var(--ink-soft); font-size:13px;">\u270f\ufe0f</button>
        </span>
        <button class="btn small danger disc-del">\u2715</button>
      </div>
      <table class="task-hours-table" style="table-layout:fixed; width:100%; max-width:100%; margin-top:10px; font-size:12.5px;">
        <thead>
          <tr>
            <th style="width:30%;"></th>
            <th></th>
            ${applicableRoles.length ? `<th class="numc sub" colspan="${applicableRoles.length}" style="font-weight:600; padding-bottom:2px;">Default Est. Hrs</th>` : ""}
            <th style="width:30px;"></th>
          </tr>
          <tr>
            <th style="width:30%;">Default tasks</th>
            <th></th>
            ${applicableRoles.map((r) => `<th class="numc" style="width:45px;">${esc(r.role)}</th>`).join("")}
            <th style="width:30px;"></th>
          </tr>
        </thead>
        <tbody class="task-drag-list" data-disc-id="${id}">
          ${tasks.map(([tid, t]) => `<tr class="task-drag-item" draggable="true" data-item-id="${tid}">
            <td><span class="sub" style="cursor:grab; user-select:none;">\u283f</span> ${esc(t.task)}</td>
            <td></td>
            ${applicableRoles.map((r) => `<td class="numc"><input type="number" class="task-role-hours" data-item-id="${tid}" data-role="${esc(r.role)}" value="${getTaskHoursForRole(t, r.role)}" min="0" step="0.5" style="width:100%; text-align:right;"></td>`).join("")}
            <td><button class="btn small danger disc-task-del" data-item-id="${tid}">\u2715</button></td>
          </tr>`).join("") || `<tr><td colspan="${colCount}" class="sub">No tasks yet.</td></tr>`}
        </tbody>
      </table>
      <div class="row-actions">
        <input type="text" class="new-task-name" placeholder="New task name" style="max-width:220px;">
        <button class="btn ghost small add-task-btn">+ Add</button>
      </div>
    </div>`;
  }).join("") || `<div class="task-empty">No disciplines yet.</div>`;

  list.querySelectorAll(".discipline-row").forEach((row) => {
    const id = row.dataset.id;

    const nameDisplay = row.querySelector(".disc-name-display");
    const nameInput = row.querySelector(".disc-name-input");
    const commitRename = () => {
      renameDiscipline(id, nameInput.value);
      nameInput.style.display = "none";
      nameDisplay.style.display = "";
    };
    row.querySelector(".disc-name-edit-btn").onclick = () => {
      nameDisplay.style.display = "none";
      nameInput.style.display = "";
      nameInput.focus();
      nameInput.select();
    };
    nameInput.onblur = commitRename;
    nameInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") nameInput.blur();
      if (e.key === "Escape") { nameInput.value = state.disciplines[id].name; nameInput.blur(); }
    });

    row.querySelector(".disc-del").onclick = () => openDeleteDisciplineConfirm(id);

    row.querySelectorAll(".task-role-hours").forEach((input) => {
      input.onchange = () => {
        const t = state.taskCatalog[input.dataset.itemId];
        const hoursByRole = { ...(t.hoursByRole || {}) };
        hoursByRole[input.dataset.role] = Number(input.value) || 0;
        db.collection("task_catalog").doc(input.dataset.itemId).update({ hoursByRole }).catch(() => {});
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
    wireTaskDragAndDrop(row.querySelector(".task-drag-list"));
    row.querySelector(".add-task-btn").onclick = async () => {
      const input = row.querySelector(".new-task-name");
      const name = input.value.trim();
      if (!name) return;
      await db.collection("task_catalog").add({ category: state.disciplines[id].name, task: name, hoursByRole: {} });
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
