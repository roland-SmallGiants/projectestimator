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
import { esc, moneyPlain, wireNumberStepper } from "./utils.js";
import { openConfirm } from "./modals.js";

// Plain SVG line icons (always monochrome, inherit currentColor) instead of
// emoji characters, which render as full-color glyphs on most systems.
const ICON_EDIT = `<svg viewBox="0 0 24 24" style="width:13px; height:13px; stroke:currentColor; fill:none; stroke-width:1.8;"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>`;
const ICON_CANCEL = `<svg viewBox="0 0 24 24" style="width:13px; height:13px; stroke:currentColor; fill:none; stroke-width:1.8;"><path d="M18 6 6 18"/><path d="M6 6l12 12"/></svg>`;
const ICON_CONFIRM = `<svg viewBox="0 0 24 24" style="width:13px; height:13px; stroke:currentColor; fill:none; stroke-width:1.8;"><path d="M20 6 9 17l-5-5"/></svg>`;
const ICON_POWER = `<svg viewBox="0 0 24 24" style="width:14px; height:14px; stroke:currentColor; fill:none; stroke-width:1.8;"><path d="M12 2v10"/><path d="M18.36 6.64a9 9 0 1 1-12.73 0"/></svg>`;
const ICON_DELETE = `<svg viewBox="0 0 24 24" style="width:13px; height:13px; stroke:currentColor; fill:none; stroke-width:1.8;"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>`;

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
      <td class="numc"><input type="number" class="role-rate" value="${r.rate}" min="0" step="1"></td>
      <td>${rows}</td>
      <td><button class="icon-btn cancel role-del" title="Delete role">${ICON_DELETE}</button></td>
    </tr>`;
  }).join("") || `<tr><td colspan="4" style="color:var(--ink-soft); text-align:center; padding:16px;">No roles yet.</td></tr>`;

  body.querySelectorAll("tr[data-id]").forEach((tr) => {
    const id = tr.dataset.id;
    const nameInput = tr.querySelector(".role-name");
    const rateInput = tr.querySelector(".role-rate");
    nameInput.onchange = () => db.collection("rate_card").doc(id).update({ role: nameInput.value }).catch(() => {});
    rateInput.onchange = () => db.collection("rate_card").doc(id).update({ rate: Number(rateInput.value) || 0 }).catch(() => {});
    wireNumberStepper(rateInput, { fullWidth: true });
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

let draggedDisciplineId = null;

function wireDisciplineDragAndDrop(listEl) {
  if (!listEl) return;
  listEl.querySelectorAll(".discipline-reorder-item").forEach((li) => {
    li.addEventListener("dragstart", () => {
      draggedDisciplineId = li.dataset.id;
      li.style.opacity = "0.4";
    });
    li.addEventListener("dragend", () => {
      li.style.opacity = "";
      draggedDisciplineId = null;
    });
    li.addEventListener("dragover", (e) => {
      e.preventDefault();
      if (!draggedDisciplineId || li.dataset.id === draggedDisciplineId) return;
      const draggedEl = listEl.querySelector(`[data-id="${draggedDisciplineId}"]`);
      if (!draggedEl) return;
      const rect = li.getBoundingClientRect();
      const before = (e.clientY - rect.top) < rect.height / 2;
      li.parentNode.insertBefore(draggedEl, before ? li : li.nextSibling);
    });
    li.addEventListener("drop", async (e) => {
      e.preventDefault();
      await persistDisciplineOrder(listEl);
    });
  });
}

async function persistDisciplineOrder(listEl) {
  const ids = [...listEl.querySelectorAll(".discipline-reorder-item")].map((li) => li.dataset.id);
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    if (state.disciplines[id] && state.disciplines[id].order === i) continue;
    await db.collection("disciplines").doc(id).update({ order: i }).catch(() => {});
  }
}

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

let draggedTodoKey = null; // `${itemId}::${originalIndex}`

function wireTodoDragAndDrop(row) {
  row.querySelectorAll(".todo-row").forEach((tr) => {
    tr.addEventListener("dragstart", (e) => {
      e.stopPropagation();
      draggedTodoKey = `${tr.dataset.itemId}::${tr.dataset.todoIndex}`;
      tr.style.opacity = "0.4";
    });
    tr.addEventListener("dragend", () => {
      tr.style.opacity = "";
      draggedTodoKey = null;
    });
    tr.addEventListener("dragover", (e) => {
      if (!draggedTodoKey) return;
      const [draggedItemId] = draggedTodoKey.split("::");
      if (tr.dataset.itemId !== draggedItemId) return; // only reorder within the same task's own to-do list
      e.preventDefault();
      e.stopPropagation();
      const draggedEl = row.querySelector(`.todo-row[data-item-id="${draggedItemId}"][data-todo-index="${draggedTodoKey.split("::")[1]}"]`);
      if (!draggedEl || draggedEl === tr) return;
      const rect = tr.getBoundingClientRect();
      const before = (e.clientY - rect.top) < rect.height / 2;
      tr.parentNode.insertBefore(draggedEl, before ? tr : tr.nextSibling);
    });
    tr.addEventListener("drop", async (e) => {
      if (!draggedTodoKey) return;
      const [draggedItemId] = draggedTodoKey.split("::");
      if (tr.dataset.itemId !== draggedItemId) return;
      e.preventDefault();
      e.stopPropagation();
      // Prefer the live input value if that row is mid-edit, otherwise the display text.
      const orderedTexts = [];
      row.querySelectorAll(`.todo-row[data-item-id="${draggedItemId}"]`).forEach((todoTr) => {
        const display = todoTr.querySelector(".todo-text-display");
        const input = todoTr.querySelector(".todo-text-input");
        const text = input && input.style.display !== "none" ? input.value.trim() : (display ? display.textContent : "");
        if (text) orderedTexts.push(text);
      });
      await db.collection("task_catalog").doc(draggedItemId).update({ todos: orderedTexts }).catch(() => {});
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
  const reorderToggleWrap = document.getElementById("disciplinesReorderToggleWrap");
  if (!list) return;
  const ids = Object.keys(state.disciplines).sort((a, b) => {
    const aInactive = state.disciplines[a].deactivated ? 1 : 0;
    const bInactive = state.disciplines[b].deactivated ? 1 : 0;
    if (aInactive !== bInactive) return aInactive - bInactive; // active first, deactivated at the end
    return (state.disciplines[a].order ?? 0) - (state.disciplines[b].order ?? 0);
  });
  // Every discipline's table shows the SAME roles, in the SAME order, at the SAME
  // width, so the columns line up consistently down the whole page. Roles that
  // don't apply to a given discipline still get a column; the cell is just disabled.
  const allRoles = Object.values(state.rateCard).filter((r) => r.role).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const ROLE_COL_WIDTH = 90; // matches the Rate Card's Hourly Rate column for a page-wide consistent look

  if (reorderToggleWrap) {
    reorderToggleWrap.innerHTML = `<button type="button" class="btn ghost small ${state.disciplineReorderMode ? "primary" : ""}" id="disciplinesReorderToggleBtn">${state.disciplineReorderMode ? "\u21c5 Done reordering" : "\u21c5 Change order"}</button>`;
    document.getElementById("disciplinesReorderToggleBtn").onclick = () => {
      state.disciplineReorderMode = !state.disciplineReorderMode;
      renderDisciplinesAdmin();
    };
  }

  // ---- Discipline reorder mode: flat, drag-only view, nothing else interactive ----
  if (state.disciplineReorderMode) {
    list.innerHTML = ids.map((id) => `<div class="discipline-row discipline-reorder-item" draggable="true" data-id="${id}">
      <span class="sub" style="cursor:grab; user-select:none; margin-right:8px;">\u283f</span>
      <span class="disc-name-display" style="font-size:13px;">${esc(state.disciplines[id].name)}</span>
    </div>`).join("") || `<div class="task-empty">No deliverables yet.</div>`;
    wireDisciplineDragAndDrop(list);
    return;
  }

  list.innerHTML = ids.map((id) => {
    const d = state.disciplines[id];
    const tasks = Object.entries(state.taskCatalog || {}).filter(([, t]) => t.category === d.name).sort((a, b) => (a[1].order ?? 0) - (b[1].order ?? 0));
    const isApplicable = (r) => !Array.isArray(r.categories) || r.categories.length === 0 || r.categories.includes(d.name);
    // Non-applicable roles are pushed to the left, applicable ones grouped on
    // the right \u2014 this means the same role can sit in a different column
    // position from one discipline to the next.
    const rolesForThisDiscipline = [...allRoles].sort((a, b) => {
      const aApp = isApplicable(a), bApp = isApplicable(b);
      if (aApp === bApp) return 0;
      return aApp ? 1 : -1;
    });

    const isOpen = state.expandedAdminDisciplines.has(id);
    const deactivated = Boolean(d.deactivated);

    const taskListHtml = (() => {
      if (!isOpen) return "";

      const headerHtml = tasks.length ? `<table style="table-layout:fixed; width:100%; font-size:11px; margin-top:10px; margin-bottom:2px;">
        <tr>
          <th style="width:30%; text-align:left; padding:0 8px 8px 22px; color:var(--ink-soft); text-transform:uppercase;">Default Estimated Hours</th>
          <th style="padding:0 8px 8px;"></th>
          ${rolesForThisDiscipline.map((r) => `<th class="numc" style="width:${ROLE_COL_WIDTH}px; padding:0 8px 8px; color:var(--ink-soft); text-transform:uppercase;">${isApplicable(r) ? esc(r.role) : ""}</th>`).join("")}
          <th style="width:30px;"></th>
        </tr>
      </table>` : "";

      const taskRowsHtml = tasks.map(([tid, t]) => {
        const todos = Array.isArray(t.todos) ? t.todos : [];
        const taskOpen = state.expandedAdminTasks.has(tid);

        const headRow = `<div class="task-row-collapsed" data-item-id="${tid}" style="border-top:1px solid rgba(255,255,255,0.06); padding:8px 4px 8px 22px; display:flex; justify-content:space-between; align-items:center;">
          <span class="task-row-toggle" style="display:flex; align-items:center; gap:8px; cursor:pointer; flex:1;">
            <span class="sub" style="display:inline-block; width:12px;">${taskOpen ? "\u25be" : "\u25b8"}</span>
            <span style="font-size:12.5px;">${esc(t.task)}</span>
          </span>
          <button class="icon-btn cancel disc-task-del" data-item-id="${tid}" title="Delete task">${ICON_DELETE}</button>
        </div>`;

        if (!taskOpen) return headRow;

        const hoursRow = `<table style="table-layout:fixed; width:100%; font-size:12.5px;">
          <tr>
            <td style="width:30%; padding:6px 8px 6px 22px;"></td>
            <td style="padding:6px 8px;"></td>
            ${rolesForThisDiscipline.map((r) => {
              const applicable = isApplicable(r);
              return `<td class="numc" style="width:${ROLE_COL_WIDTH}px; padding:6px 8px;">${applicable
                ? `<input type="number" class="task-role-hours" data-item-id="${tid}" data-role="${esc(r.role)}" value="${getTaskHoursForRole(t, r.role)}" min="0" step="0.5">`
                : `<span title="${esc(r.role)} doesn't apply to ${esc(d.name)}"></span>`}</td>`;
            }).join("")}
            <td style="width:30px;"></td>
          </tr>
        </table>`;

        // Expanding a task now shows its to-dos directly \u2014 no separate toggle.
        const todoRowsHtml = todos.map((todoText, ti) => `<div class="todo-row" draggable="true" data-item-id="${tid}" data-todo-index="${ti}" style="background:rgba(255,255,255,0.02); padding:5px 8px 5px 34px; display:flex; align-items:center; gap:8px;">
          <span class="sub todo-drag-handle" style="cursor:grab; user-select:none;">\u283f</span>
          <span class="sub todo-text-display" style="flex:1;" data-item-id="${tid}" data-todo-index="${ti}">${esc(todoText)}</span>
          <input type="text" class="todo-text-input" value="${esc(todoText)}" data-item-id="${tid}" data-todo-index="${ti}" style="display:none; flex:1;">
          <button type="button" class="icon-btn todo-edit-btn" data-item-id="${tid}" data-todo-index="${ti}" title="Edit">${ICON_EDIT}</button>
          <button type="button" class="icon-btn cancel todo-cancel-btn" data-item-id="${tid}" data-todo-index="${ti}" title="Cancel" style="display:none;">${ICON_CANCEL}</button>
          <button type="button" class="icon-btn confirm todo-confirm-btn" data-item-id="${tid}" data-todo-index="${ti}" title="Confirm" style="display:none;">${ICON_CONFIRM}</button>
          <button class="icon-btn cancel todo-del-btn" data-item-id="${tid}" data-todo-index="${ti}" title="Delete to-do">${ICON_DELETE}</button>
        </div>`).join("");

        const addTodoHtml = `<div style="background:rgba(255,255,255,0.02); padding:6px 8px 10px 34px; display:flex; align-items:center; gap:8px;">
          <input type="text" class="new-todo-input" data-item-id="${tid}" placeholder="New to-do" style="max-width:320px;">
          <button type="button" class="btn ghost small add-todo-btn" data-item-id="${tid}">+ Add to-do</button>
        </div>`;

        return headRow + hoursRow + todoRowsHtml + addTodoHtml;
      }).join("") || `<div class="task-empty" style="padding-left:22px;">No tasks yet.</div>`;

      return `${headerHtml}
      <div class="task-drag-list" data-disc-id="${id}">${taskRowsHtml}</div>
      <div class="row-actions">
        <button type="button" class="btn ghost small add-task-toggle-btn" data-disc-id="${id}">+ Add task</button>
        <span class="new-task-form" data-disc-id="${id}" style="display:none; gap:8px; align-items:center;">
          <input type="text" class="new-task-name" placeholder="New task name" style="max-width:220px;">
          <button class="btn ghost small add-task-btn">Add</button>
        </span>
      </div>`;
    })();

    return `<div class="discipline-row ${deactivated ? "discipline-deactivated" : ""}" data-id="${id}">
      <div style="display:flex; justify-content:space-between; align-items:center; gap:10px;">
        <span class="disc-collapse-toggle" style="display:flex; align-items:center; gap:8px; cursor:pointer;">
          <span style="display:inline-block; width:14px; color:var(--ink-soft);">${isOpen ? "\u25be" : "\u25b8"}</span>
          <span class="disc-name-display" style="font-size:13px; font-weight:400;">${esc(d.name)}</span>
          <input type="text" class="disc-name-input" value="${esc(d.name)}" style="display:none; font-size:13px; font-weight:400; max-width:260px;">
          ${deactivated ? `<span class="sub" style="color:var(--rose);">Deactivated</span>` : ""}
        </span>
        <span style="display:flex; align-items:center; gap:4px;">
          <button type="button" class="disc-name-edit-btn icon-btn" title="Rename deliverable">${ICON_EDIT}</button>
          <button type="button" class="disc-name-cancel-btn icon-btn cancel" title="Cancel" style="display:none;">${ICON_CANCEL}</button>
          <button type="button" class="disc-name-confirm-btn icon-btn confirm" title="Confirm" style="display:none;">${ICON_CONFIRM}</button>
          <button type="button" class="icon-btn disc-toggle-active-btn" title="${deactivated ? "Reactivate deliverable" : "Deactivate deliverable"}">${ICON_POWER}</button>
        </span>
      </div>
      ${taskListHtml}
    </div>`;
  }).join("") || `<div class="task-empty">No deliverables yet.</div>`;

  list.querySelectorAll(".discipline-row").forEach((row) => {
    const id = row.dataset.id;

    row.querySelector(".disc-collapse-toggle").onclick = (e) => {
      if (e.target.classList.contains("disc-name-input")) return; // don't collapse while editing the name
      if (state.expandedAdminDisciplines.has(id)) state.expandedAdminDisciplines.delete(id);
      else state.expandedAdminDisciplines.add(id);
      renderDisciplinesAdmin();
    };

    const nameDisplay = row.querySelector(".disc-name-display");
    const nameInput = row.querySelector(".disc-name-input");
    const nameEditBtn = row.querySelector(".disc-name-edit-btn");
    const nameCancelBtn = row.querySelector(".disc-name-cancel-btn");
    const nameConfirmBtn = row.querySelector(".disc-name-confirm-btn");
    const enterNameEdit = () => {
      nameDisplay.style.display = "none";
      nameInput.style.display = "";
      nameEditBtn.style.display = "none";
      nameCancelBtn.style.display = "";
      nameConfirmBtn.style.display = "";
      nameInput.focus();
      nameInput.select();
    };
    const exitNameEdit = () => {
      nameDisplay.style.display = "";
      nameInput.style.display = "none";
      nameEditBtn.style.display = "";
      nameCancelBtn.style.display = "none";
      nameConfirmBtn.style.display = "none";
    };
    nameEditBtn.onclick = enterNameEdit;
    nameCancelBtn.onclick = () => {
      nameInput.value = state.disciplines[id].name;
      exitNameEdit();
    };
    nameConfirmBtn.onclick = () => {
      renameDiscipline(id, nameInput.value);
      exitNameEdit();
    };
    nameInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") nameConfirmBtn.click();
      if (e.key === "Escape") nameCancelBtn.click();
    });

    row.querySelector(".disc-toggle-active-btn").onclick = () => {
      const currentlyDeactivated = Boolean(state.disciplines[id] && state.disciplines[id].deactivated);
      db.collection("disciplines").doc(id).update({ deactivated: !currentlyDeactivated }).catch(() => {});
    };

    row.querySelectorAll(".task-row-toggle").forEach((toggle) => {
      toggle.onclick = () => {
        const tid = toggle.closest(".task-row-collapsed").dataset.itemId;
        const wasOpen = state.expandedAdminTasks.has(tid);
        if (!wasOpen) {
          // Accordion within this discipline: opening a task closes any other
          // open task belonging to the same discipline.
          const category = state.taskCatalog[tid] ? state.taskCatalog[tid].category : null;
          [...state.expandedAdminTasks].forEach((openId) => {
            const openCategory = state.taskCatalog[openId] ? state.taskCatalog[openId].category : null;
            if (openCategory === category) state.expandedAdminTasks.delete(openId);
          });
          state.expandedAdminTasks.add(tid);
        } else {
          state.expandedAdminTasks.delete(tid);
        }
        renderDisciplinesAdmin();
      };
    });

    row.querySelectorAll(".task-role-hours").forEach((input) => {
      input.onchange = () => {
        const t = state.taskCatalog[input.dataset.itemId];
        const hoursByRole = { ...(t.hoursByRole || {}) };
        hoursByRole[input.dataset.role] = Number(input.value) || 0;
        db.collection("task_catalog").doc(input.dataset.itemId).update({ hoursByRole }).catch(() => {});
      };
      wireNumberStepper(input, { fullWidth: true });
    });
    row.querySelectorAll(".disc-task-del").forEach((btn) => {
      btn.onclick = () => {
        const itemId = btn.dataset.itemId;
        const taskName = state.taskCatalog[itemId] ? state.taskCatalog[itemId].task : "(untitled task)";
        openConfirm(
          "Delete this task?",
          `This permanently removes "${taskName}" from ${state.disciplines[id] ? state.disciplines[id].name : "this deliverable"}'s default task list. Drafts that already have it keep their own copy; it just won't be offered to new drafts.`,
          async () => { await db.collection("task_catalog").doc(itemId).delete().catch(() => {}); }
        );
      };
    });

    row.querySelectorAll(".todo-edit-btn").forEach((btn) => {
      const { itemId, todoIndex } = btn.dataset;
      const display = row.querySelector(`.todo-text-display[data-item-id="${itemId}"][data-todo-index="${todoIndex}"]`);
      const input = row.querySelector(`.todo-text-input[data-item-id="${itemId}"][data-todo-index="${todoIndex}"]`);
      const cancelBtn = row.querySelector(`.todo-cancel-btn[data-item-id="${itemId}"][data-todo-index="${todoIndex}"]`);
      const confirmBtn = row.querySelector(`.todo-confirm-btn[data-item-id="${itemId}"][data-todo-index="${todoIndex}"]`);
      if (!display || !input || !cancelBtn || !confirmBtn) return;

      const enterEdit = () => {
        display.style.display = "none";
        input.style.display = "";
        btn.style.display = "none";
        cancelBtn.style.display = "";
        confirmBtn.style.display = "";
        input.focus();
        input.select();
      };
      const exitEdit = () => {
        display.style.display = "";
        input.style.display = "none";
        btn.style.display = "";
        cancelBtn.style.display = "none";
        confirmBtn.style.display = "none";
      };
      btn.onclick = enterEdit;
      cancelBtn.onclick = () => {
        input.value = display.textContent;
        exitEdit();
      };
      confirmBtn.onclick = async () => {
        const t = state.taskCatalog[itemId];
        if (!t) return;
        const todos = [...(Array.isArray(t.todos) ? t.todos : [])];
        const newText = input.value.trim();
        if (newText) todos[Number(todoIndex)] = newText;
        await db.collection("task_catalog").doc(itemId).update({ todos }).catch(() => {});
        exitEdit();
      };
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") confirmBtn.click();
        if (e.key === "Escape") cancelBtn.click();
      });
    });
    row.querySelectorAll(".todo-del-btn").forEach((btn) => {
      btn.onclick = async () => {
        const { itemId, todoIndex } = btn.dataset;
        const t = state.taskCatalog[itemId];
        if (!t) return;
        const todos = [...(Array.isArray(t.todos) ? t.todos : [])];
        todos.splice(Number(todoIndex), 1);
        await db.collection("task_catalog").doc(itemId).update({ todos }).catch(() => {});
      };
    });
    row.querySelectorAll(".add-todo-btn").forEach((btn) => {
      btn.onclick = async () => {
        const itemId = btn.dataset.itemId;
        const input = row.querySelector(`.new-todo-input[data-item-id="${itemId}"]`);
        const text = input.value.trim();
        if (!text) return;
        const t = state.taskCatalog[itemId];
        const todos = [...(t && Array.isArray(t.todos) ? t.todos : []), text];
        await db.collection("task_catalog").doc(itemId).update({ todos }).catch(() => {});
        input.value = "";
      };
    });
    wireTodoDragAndDrop(row);
    const addTaskToggleBtn = row.querySelector(".add-task-toggle-btn");
    const newTaskForm = row.querySelector(".new-task-form");
    if (addTaskToggleBtn && newTaskForm) {
      addTaskToggleBtn.onclick = () => {
        addTaskToggleBtn.style.display = "none";
        newTaskForm.style.display = "inline-flex";
        newTaskForm.querySelector(".new-task-name").focus();
      };
    }
    const addTaskBtn = row.querySelector(".add-task-btn");
    if (addTaskBtn) {
      addTaskBtn.onclick = async () => {
        const input = row.querySelector(".new-task-name");
        const name = input.value.trim();
        if (!name) return;
        await db.collection("task_catalog").add({ category: state.disciplines[id].name, task: name, hoursByRole: {} });
        input.value = "";
        if (addTaskToggleBtn && newTaskForm) {
          newTaskForm.style.display = "none";
          addTaskToggleBtn.style.display = "";
        }
      };
    }
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

export function wireAddDiscipline() {
  document.getElementById("addDiscipline").onclick = async () => {
    const ids = Object.keys(state.disciplines);
    const order = ids.length ? Math.max(...ids.map((id) => state.disciplines[id].order ?? 0)) + 1 : 0;
    await db.collection("disciplines").add({ name: "New deliverable", order });
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

  const staleInput = document.getElementById("staleThresholdInput");
  if (staleInput) {
    if (document.activeElement !== staleInput) staleInput.value = state.settings.staleQuoteThresholdWeeks ?? 2;
    staleInput.onchange = () => {
      const v = Math.max(1, Number(staleInput.value) || 2);
      db.doc("settings/main").update({ staleQuoteThresholdWeeks: v }).catch(() => {});
    };
    wireNumberStepper(staleInput, { fullWidth: true });
  }
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
    ${u === "Roland" ? "" : `<button type="button" class="icon-btn cancel team-remove-btn" data-name="${esc(u)}" title="Remove">${ICON_DELETE}</button>`}
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
