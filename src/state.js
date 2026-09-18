// Central mutable state for the app. Kept as a single plain object (rather
// than a framework store) to match the original artifact's style and keep
// this dependency-free.

export const state = {
  currentUser: null,
  isAdmin: false,

  settings: { adminPin: "1234", contingencyPct: 0.15, knownUsers: ["Nick", "Desiree", "Roland"] },

  disciplines: {},   // id -> { name, order }
  rateCard: {},      // id -> { role, rate, order, categories[] }
  taskCatalog: {},   // id -> { category, task, defaultHours } — admin-managed template

  drafts: {},        // id -> draft doc
  currentDraftId: null,
  draftItems: {},    // id -> { draftId, category, task, role, hours, qty, notes, defaultHours, hoursOverridden, excluded, custom }

  quotes: {},        // id -> archived quote snapshot

  activeTab: null,          // active discipline tab in the estimator
  expandedSummaryCategories: new Set(),
  expandedHoursComparisonTasks: new Set(),
  expandedHoursDisciplines: new Set(),
  expandedNeverUsedDisciplines: new Set(),
  expandedAdminDisciplines: new Set(),
  expandedArchiveCategories: new Set(),
  expandedEditHistory: new Set(),
  openArchiveDetails: new Set(),
  reportChartType: "grouped",
  hoursPerRoleMetric: "hours",
  reportMonthOverrides: {},

  lockHeartbeatTimer: null,
};

export function CATEGORIES() {
  return Object.values(state.disciplines)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .map((d) => d.name);
}

export function rateForRole(roleName) {
  for (const id in state.rateCard) {
    if (state.rateCard[id].role === roleName) return Number(state.rateCard[id].rate) || 0;
  }
  return 0;
}

export function effectiveHours(it) {
  return (Number(it.hours) || 0) * (Number(it.qty) || 1);
}

export function sortedRateIds() {
  return Object.keys(state.rateCard).sort((a, b) => (state.rateCard[a].order ?? 0) - (state.rateCard[b].order ?? 0));
}
