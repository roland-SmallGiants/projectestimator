import { db } from "./firebase-init.js";
import { state, CATEGORIES, rateForRole, effectiveHours, sortedRateIds } from "./state.js";
import { esc, money, moneyPlain, notesIcon, levenshtein, normalizeClientName, wireAutocomplete } from "./utils.js";
import { seedDraftItemsForDiscipline, lockOwner } from "./drafts.js";
import { getTaskHoursForRole } from "./admin.js";

function currentDraft() {
  return state.currentDraftId ? state.drafts[state.currentDraftId] : null;
}

export function isReadOnly() {
  const d = currentDraft();
  if (!d) return true;
  const owner = lockOwner(d);
  return !!owner && owner !== state.currentUser;
}

export function renderLockBanner() {
  const el = document.getElementById("lockBanner");
  if (!el) return;
  const d = currentDraft();
  if (!d) { el.style.display = "none"; return; }
  const owner = lockOwner(d);
  if (owner && owner !== state.currentUser) {
    el.style.display = "block";
    el.textContent = `\u26a0 ${owner} is currently working on this quote. You're viewing it read-only.`;
  } else {
    el.style.display = "none";
  }
}

export function renderSaveButtonLabel() {
  const btn = document.getElementById("saveQuoteBtn");
  if (!btn) return;
  const d = currentDraft();
  const isEditingExisting = d && d.sourceQuoteId && state.quotes[d.sourceQuoteId];
  btn.textContent = isEditingExisting ? "Update Quote" : "Save Quote";
}

function knownClientNames() {
  const names = new Set();
  Object.values(state.quotes || {}).forEach((q) => {
    if (q.clientName && q.clientName !== "(no client name)") names.add(q.clientName);
  });
  return [...names];
}

export function wireClientNameAutocomplete() {
  const inputEl = document.getElementById("clientNameInput");
  const dropdownEl = document.getElementById("clientNameDropdown");
  if (!inputEl || !dropdownEl) return;
  wireAutocomplete(inputEl, dropdownEl, knownClientNames, (value) => {
    if (isReadOnly()) return;
    document.getElementById("clientNameSuggestion").innerHTML = "";
    db.collection("drafts").doc(state.currentDraftId).update({ clientName: value }).catch(() => {});
  });
}

function checkClientNameSuggestion() {
  const nameInput = document.getElementById("clientNameInput");
  const suggestionEl = document.getElementById("clientNameSuggestion");
  if (!nameInput || !suggestionEl) return;
  const typed = nameInput.value.trim();
  suggestionEl.innerHTML = "";
  if (!typed) return;
  const known = knownClientNames();
  if (known.includes(typed)) return; // exact match, nothing to suggest
  let best = null, bestDist = Infinity;
  known.forEach((n) => {
    const dist = levenshtein(typed, n);
    if (dist < bestDist) { bestDist = dist; best = n; }
  });
  // Only suggest for small, "probably a typo/casing slip" distances relative to the name's length.
  if (best && bestDist > 0 && bestDist <= Math.max(2, Math.ceil(best.length * 0.25))) {
    suggestionEl.innerHTML = `Did you mean <a href="#" id="clientNameSuggestionLink" style="color:var(--accent-ink); font-weight:600;">${esc(best)}</a>?`;
    document.getElementById("clientNameSuggestionLink").onclick = (e) => {
      e.preventDefault();
      nameInput.value = best;
      suggestionEl.innerHTML = "";
      nameInput.dispatchEvent(new Event("change"));
    };
  }
}

export function renderClientSection() {
  const d = currentDraft();
  if (!d) return;
  const ro = isReadOnly();
  const nameInput = document.getElementById("clientNameInput");
  const descInput = document.getElementById("projectDescriptionInput");
  if (document.activeElement !== nameInput) nameInput.value = d.clientName || "";
  if (document.activeElement !== descInput) descInput.value = d.projectDescription || "";
  nameInput.disabled = ro;
  descInput.disabled = ro;
  nameInput.onchange = () => {
    if (ro) return;
    const normalized = normalizeClientName(nameInput.value);
    nameInput.value = normalized;
    document.getElementById("clientNameSuggestion").innerHTML = "";
    db.collection("drafts").doc(state.currentDraftId).update({ clientName: normalized }).catch(() => {});
  };
  nameInput.oninput = () => !ro && checkClientNameSuggestion();
  descInput.onchange = () => !ro && db.collection("drafts").doc(state.currentDraftId).update({ projectDescription: descInput.value }).catch(() => {});
  descInput.oninput = () => {
    if (descInput.value.trim()) {
      const errEl = document.getElementById("projectDescriptionError");
      if (errEl) errEl.style.display = "none";
    }
  };
}

export function renderDisciplineSelector() {
  const d = currentDraft();
  if (!d) return;
  const ro = isReadOnly();
  const wrap = document.getElementById("disciplineChips");
  const selected = d.disciplines || [];

  wrap.style.display = d.disciplineMode ? "" : "none";
  const divider = document.getElementById("disciplineDivider");
  if (divider) divider.style.display = d.disciplineMode ? "" : "none";
  const label = document.getElementById("disciplineChipsLabel");
  if (label) label.style.display = d.disciplineMode ? "" : "none";
  wrap.innerHTML = CATEGORIES().map((c) =>
    `<button type="button" class="chip ${selected.includes(c) ? "on" : ""}" data-cat="${esc(c)}" ${ro ? "disabled" : ""}>${esc(c)}</button>`
  ).join("");
  wrap.querySelectorAll(".chip").forEach((chip) => {
    chip.onclick = async () => {
      if (ro) return;
      const cat = chip.dataset.cat;
      let next;
      if (d.disciplineMode === "multiple") {
        next = selected.includes(cat) ? selected.filter((c) => c !== cat) : [...selected, cat];
      } else {
        next = [cat];
      }
      await db.collection("drafts").doc(state.currentDraftId).update({ disciplines: next, disciplineModeChosen: true }).catch(() => {});
      if (!selected.includes(cat)) await seedDraftItemsForDiscipline(state.currentDraftId, cat, state.taskCatalog);
      if (!state.activeTab || !next.includes(state.activeTab)) state.activeTab = next[0] || null;
    };
  });

  document.querySelectorAll("#disciplineModeChips button").forEach((btn) => {
    btn.classList.toggle("on", btn.dataset.mode === d.disciplineMode);
    btn.disabled = ro;
    btn.onclick = async () => {
      if (ro) return;
      const mode = btn.dataset.mode;
      const next = mode === "single" ? (d.disciplines[0] ? [d.disciplines[0]] : []) : d.disciplines;
      await db.collection("drafts").doc(state.currentDraftId).update({ disciplineMode: mode, disciplines: next }).catch(() => {});
    };
  });
}

export function renderItemTabs() {
  const d = currentDraft();
  if (!d) return;
  const wrap = document.getElementById("itemTabs");
  const canonicalOrder = CATEGORIES();
  const selected = (d.disciplines || [])
    .filter((c) => canonicalOrder.includes(c))
    .sort((a, b) => canonicalOrder.indexOf(a) - canonicalOrder.indexOf(b));
  if (!selected.includes(state.activeTab)) state.activeTab = selected[0] || null;
  wrap.innerHTML = selected.map((c) =>
    `<button type="button" class="work-tab-item ${c === state.activeTab ? "active" : ""}" data-cat="${esc(c)}">${esc(c)}</button>`
  ).join("");
  wrap.querySelectorAll(".work-tab-item").forEach((tab) => {
    tab.onclick = () => { state.activeTab = tab.dataset.cat; renderItemTabs(); renderItems(); };
  });
}

export function renderItems() {
  const ro = isReadOnly();
  const body = document.getElementById("itemsBody");
  if (!body || !state.activeTab) { if (body) body.innerHTML = ""; return; }
  const items = Object.entries(state.draftItems)
    .filter(([, it]) => it.category === state.activeTab && !it.excluded)
    .sort((a, b) => (a[1].order ?? 0) - (b[1].order ?? 0));
  const roleOptions = sortedRateIds()
    .map((id) => state.rateCard[id])
    .filter((r) => r && r.role && (!Array.isArray(r.categories) || r.categories.length === 0 || r.categories.includes(state.activeTab)))
    .map((r) => r.role);

  body.innerHTML = items.map(([id, it]) => {
    const options = (it.role && !roleOptions.includes(it.role)) ? [...roleOptions, it.role] : roleOptions;
    const hours = effectiveHours(it);
    const cost = it.role ? hours * rateForRole(it.role) : 0;
    return `<tr data-id="${id}">
      <td>${esc(it.task)}${notesIcon(it.notes)}</td>
      <td class="numc"><input type="number" class="it-qty" data-id="${id}" value="${it.qty ?? 1}" min="1" step="1" ${ro ? "disabled" : ""}></td>
      <td><select class="it-role" data-id="${id}" ${ro ? "disabled" : ""}><option value="">\u2014</option>${options.map((r) => `<option ${it.role === r ? "selected" : ""}>${esc(r)}</option>`).join("")}</select></td>
      <td class="numc"><input type="number" class="it-hours" data-id="${id}" value="${it.hours ?? 0}" min="0" step="0.5" ${ro ? "disabled" : ""}></td>
      <td class="num">${moneyPlain(cost)}</td>
      <td><input type="text" class="it-notes" data-id="${id}" value="${esc(it.notes || "")}" ${ro ? "disabled" : ""}></td>
      <td>${ro ? "" : `<button class="btn small danger it-del" data-id="${id}">\u2715</button>`}</td>
    </tr>`;
  }).join("") || `<tr><td colspan="7" class="sub" style="text-align:center; padding:16px;">No tasks in this deliverable yet.</td></tr>`;

  if (!ro && items.length) {
    body.innerHTML += `<tr>
      <td colspan="2" class="sub" style="text-align:right;">Set all roles to</td>
      <td><select id="bulkRoleSelect"><option value="">Set all to\u2026</option>${roleOptions.map((r) => `<option>${esc(r)}</option>`).join("")}</select></td>
      <td colspan="4"></td>
    </tr>`;
  }

  if (ro) return;

  body.querySelectorAll(".it-qty").forEach((el) => el.onchange = () => updateItem(el.dataset.id, { qty: Number(el.value) || 1 }));
  body.querySelectorAll(".it-role").forEach((el) => el.onchange = () => {
    const id = el.dataset.id;
    const it = state.draftItems[id];
    const newRole = el.value;
    const patch = { role: newRole };
    if (newRole && it && !it.hoursOverridden) {
      const catalogEntry = Object.values(state.taskCatalog || {}).find((t) => t.category === it.category && t.task === it.task);
      if (catalogEntry) patch.hours = getTaskHoursForRole(catalogEntry, newRole);
    }
    updateItem(id, patch);
  });
  body.querySelectorAll(".it-hours").forEach((el) => el.onchange = () => updateItem(el.dataset.id, { hours: Number(el.value) || 0, hoursOverridden: true }));
  body.querySelectorAll(".it-notes").forEach((el) => el.onchange = () => updateItem(el.dataset.id, { notes: el.value }));
  body.querySelectorAll(".it-del").forEach((el) => el.onclick = () => {
    const it = state.draftItems[el.dataset.id];
    if (it.custom) db.collection("draft_items").doc(el.dataset.id).delete().catch(() => {});
    else updateItem(el.dataset.id, { excluded: true, hours: 0, role: "" });
  });

  const bulkSelect = document.getElementById("bulkRoleSelect");
  if (bulkSelect) {
    bulkSelect.onchange = () => {
      if (!bulkSelect.value) return;
      items.forEach(([id]) => updateItem(id, { role: bulkSelect.value }));
      bulkSelect.value = "";
    };
  }

  const addBtn = document.getElementById("addItem");
  if (addBtn) addBtn.onclick = async () => {
    await db.collection("draft_items").add({
      draftId: state.currentDraftId, category: state.activeTab, task: "New task", role: "",
      hours: 0, qty: 1, notes: "", defaultHours: 0, hoursOverridden: false, excluded: false, custom: true,
    });
  };
}

function updateItem(id, patch) {
  return db.collection("draft_items").doc(id).update(patch).catch(() => {});
}

export function renderSummary() {
  const body = document.getElementById("summaryBody");
  if (!body) return;
  const d = currentDraft();
  if (!d) { body.innerHTML = ""; return; }
  const selected = (d.disciplines || []).filter((c) => CATEGORIES().includes(c));

  let grandHours = 0, grandCost = 0;
  const rows = selected.map((c) => {
    const items = Object.entries(state.draftItems).filter(([, it]) => it.category === c && !it.excluded && it.role && (Number(it.hours) || 0) > 0).sort((a, b) => (a[1].order ?? 0) - (b[1].order ?? 0));
    const hours = items.reduce((s, [, it]) => s + effectiveHours(it), 0);
    const cost = items.reduce((s, [, it]) => s + effectiveHours(it) * rateForRole(it.role), 0);
    grandHours += hours; grandCost += cost;
    const key = c;
    const isOpen = state.expandedSummaryCategories.has(key);
    const catRow = `<tr class="summary-cat-row" data-key="${esc(key)}" style="cursor:pointer;">
      <td><span style="display:inline-block; width:14px;">${isOpen ? "\u25be" : "\u25b8"}</span>${esc(c)}</td>
      <td class="numc">${hours.toLocaleString("nl-NL")}</td>
      <td class="num">${moneyPlain(cost)}</td>
    </tr>`;
    if (!isOpen) return catRow;
    const taskRows = items.length
      ? items.map(([, it]) => `<tr class="summary-task-row">
          <td style="padding-left:26px; font-size:12.5px; color:var(--ink-soft);">${esc(it.task)}${notesIcon(it.notes)}</td>
          <td class="numc" style="font-size:12.5px; color:var(--ink-soft);">${effectiveHours(it).toLocaleString("nl-NL")}</td>
          <td class="num" style="font-size:12.5px; color:var(--ink-soft);">${moneyPlain(effectiveHours(it) * rateForRole(it.role))}</td>
        </tr>`).join("")
      : `<tr class="summary-task-row"><td colspan="3" style="padding-left:26px; font-size:12.5px; color:var(--ink-soft);">No tasks with a role assigned yet.</td></tr>`;
    return catRow + taskRows;
  }).join("");

  const contingency = state.settings.contingencyPct ?? 0.15;
  const finalPrice = grandCost * (1 + contingency);

  body.innerHTML = rows + `<tr class="summary-row final"><td>Final quoted price</td><td class="numc">${grandHours.toLocaleString("nl-NL")}</td><td class="num">${moneyPlain(finalPrice)}</td></tr>`;

  body.querySelectorAll(".summary-cat-row").forEach((tr) => {
    tr.onclick = () => {
      const key = tr.dataset.key;
      if (state.expandedSummaryCategories.has(key)) state.expandedSummaryCategories.delete(key);
      else state.expandedSummaryCategories.add(key);
      renderSummary();
    };
  });

  return { grandHours, grandCost, finalPrice };
}

export function buildQuoteSnapshot() {
  const d = currentDraft();
  const selected = (d.disciplines || []).filter((c) => CATEGORIES().includes(c));
  const items = Object.values(state.draftItems).filter((it) => !it.excluded && selected.includes(it.category)).map((it) => ({
    category: it.category, task: it.task, role: it.role || "", hours: effectiveHours(it),
    qty: it.qty ?? 1, cost: it.role ? effectiveHours(it) * rateForRole(it.role) : 0, notes: it.notes || "",
  }));
  const { grandHours, grandCost, finalPrice } = renderSummary();
  return {
    clientName: d.clientName || "(no client name)",
    projectDescription: d.projectDescription || "",
    savedAt: new Date().toISOString(),
    disciplineMode: d.disciplineMode,
    disciplines: selected,
    contingencyPct: state.settings.contingencyPct ?? 0.15,
    grandHours, grandCost, finalPrice, items,
  };
}

export function renderEstimatorView() {
  renderLockBanner();
  renderSaveButtonLabel();
  renderClientSection();
  renderDisciplineSelector();
  renderItemTabs();
  renderItems();
  renderSummary();
}
