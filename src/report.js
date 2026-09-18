import { state, CATEGORIES, rateForRole } from "./state.js";
import { esc, money, computeNiceAxis, formatAxisValue, formatDate } from "./utils.js";

export function computeMonthlyRevenueData() {
  const months = {};
  Object.values(state.quotes).forEach((q) => {
    const status = q.status === "won" || q.status === "lost" ? q.status : "pending";
    const dateVal = status === "pending" ? q.savedAt : (q.statusChangedAt || q.savedAt);
    const d = dateVal ? new Date(dateVal) : null;
    if (!d || isNaN(d)) return;
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    if (!months[key]) months[key] = { label: d.toLocaleDateString(undefined, { year: "numeric", month: "short" }), pending: 0, won: 0, lost: 0 };
    months[key][status] += q.finalPrice || 0;
  });
  const keys = Object.keys(months).sort().slice(-12);
  return { months, keys };
}

export function computeReportInsights() {
  const { months, keys } = computeMonthlyRevenueData();
  const insights = [];
  if (!keys.length) return insights;
  const currentKey = keys[keys.length - 1];
  const prevKey = keys.length >= 2 ? keys[keys.length - 2] : null;
  const current = months[currentKey];
  const prev = prevKey ? months[prevKey] : null;

  if (prev && prev.won > 0) {
    const pct = ((current.won - prev.won) / prev.won) * 100;
    if (Math.abs(pct) >= 20) insights.push({ type: pct > 0 ? "up" : "down", text: `Won revenue is ${pct > 0 ? "up" : "down"} ${Math.abs(pct).toFixed(0)}% this month vs. last month (${money(current.won)} vs. ${money(prev.won)}).` });
  } else if (prev && current.won > 0 && prev.won === 0) {
    insights.push({ type: "up", text: `First won revenue in a while: ${money(current.won)} this month, after a quiet ${prev.label}.` });
  }

  if (keys.length >= 3) {
    const wonByMonth = keys.map((k) => months[k].won);
    const maxWon = Math.max(...wonByMonth), minWon = Math.min(...wonByMonth);
    if (current.won > 0 && current.won === maxWon && wonByMonth.filter((v) => v === maxWon).length === 1) {
      insights.push({ type: "milestone", text: `${current.label} is your best month for won revenue so far, at ${money(current.won)}.` });
    } else if (current.won === minWon && minWon < maxWon && keys.length >= 4) {
      insights.push({ type: "down", text: `${current.label} is the quietest month for won revenue in this stretch (${money(current.won)}).` });
    }
  }

  const currentDecided = current.won + current.lost;
  if (currentDecided > 0) {
    const currentWinRate = current.won / currentDecided;
    const priorKeys = keys.slice(0, -1);
    const priorWon = priorKeys.reduce((s, k) => s + months[k].won, 0);
    const priorLost = priorKeys.reduce((s, k) => s + months[k].lost, 0);
    const priorDecided = priorWon + priorLost;
    if (priorDecided > 0) {
      const priorWinRate = priorWon / priorDecided;
      const diffPts = (currentWinRate - priorWinRate) * 100;
      if (Math.abs(diffPts) >= 20) insights.push({ type: diffPts > 0 ? "up" : "down", text: `Win rate is ${diffPts > 0 ? "up" : "down"} ${Math.abs(diffPts).toFixed(0)} points this month: ${(currentWinRate * 100).toFixed(0)}% won vs. a ${(priorWinRate * 100).toFixed(0)}% average before now.` });
    }
  }

  const thresholds = [10000, 25000, 50000, 100000, 250000, 500000, 1000000, 2500000, 5000000];
  let cumBefore = 0;
  for (const k of keys) { if (k === currentKey) break; cumBefore += months[k].won; }
  const crossed = thresholds.filter((t) => cumBefore < t && cumBefore + current.won >= t).pop();
  if (crossed) insights.push({ type: "milestone", text: `Total won revenue just passed ${money(crossed)} all-time.` });

  let streak = 0;
  for (let i = keys.length - 1; i >= 0; i--) {
    const m = months[keys[i]];
    if (m.won > m.lost && (m.won > 0 || m.lost > 0)) streak++; else break;
  }
  if (streak >= 3) insights.push({ type: "milestone", text: `${streak} months in a row where won revenue has outpaced lost revenue.` });

  if (!insights.length) insights.push({ type: "neutral", text: `Nothing unusual to report for ${current.label} \u2014 in line with recent months.` });
  return insights;
}

export function renderReportInsights() {
  const wrap = document.getElementById("reportInsights");
  if (!wrap) return;
  const icons = { up: "\u25b2", down: "\u25bc", milestone: "\u2605", neutral: "\u2013" };
  wrap.innerHTML = computeReportInsights().map((i) =>
    `<div class="insight-row"><span class="insight-icon ${i.type}">${icons[i.type]}</span><span>${esc(i.text)}</span></div>`
  ).join("");
}

function wireChartBarTooltips(wrap) {
  const svgEl = wrap.querySelector("svg");
  const tooltip = wrap.querySelector(".chart-tooltip");
  wrap.querySelectorAll(".report-chart-bar").forEach((rect) => {
    rect.addEventListener("mouseenter", () => { tooltip.textContent = rect.dataset.tooltip; tooltip.style.display = "block"; });
    rect.addEventListener("mousemove", (e) => {
      const r = svgEl.getBoundingClientRect();
      tooltip.style.left = Math.min(e.clientX - r.left + 12, r.width - 140) + "px";
      tooltip.style.top = (e.clientY - r.top - 32) + "px";
    });
    rect.addEventListener("mouseleave", () => { tooltip.style.display = "none"; });
  });
}

const COLORS = { pending: "#9C9AAE", won: "#FFBA30", lost: "#D64545" };
// Same tonal family as the Revenue chart (amber/gray/rose) instead of the
// brighter rainbow used for person avatars, so this chart feels consistent
// with the rest of the Report page.
const ROLE_COLORS = ["#FFBA30", "#9C9AAE", "#D64545", "#C99A3D", "#6B6A78", "#E8935C"];
const ROLE_LABEL_TEXT_COLORS = ["#1C1B33", "#1C1B33", "#fff", "#1C1B33", "#fff", "#1C1B33"]; // matches ROLE_COLORS by index
function roleColorFor(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) % ROLE_COLORS.length;
  return ROLE_COLORS[Math.abs(hash) % ROLE_COLORS.length];
}
function roleLabelTextColorFor(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) % ROLE_COLORS.length;
  return ROLE_LABEL_TEXT_COLORS[Math.abs(hash) % ROLE_COLORS.length];
}
const LABEL_TEXT_COLOR = { pending: "#1C1B33", won: "#1C1B33", lost: "#fff" };

function chartShell(colors, gridLines, bars) {
  return `<div style="display:flex; gap:16px; margin-bottom:8px; font-size:12px; color:var(--ink-soft);">
      <span><span style="display:inline-block; width:10px; height:10px; background:${colors.pending}; border-radius:2px; margin-right:5px;"></span>Pending</span>
      <span><span style="display:inline-block; width:10px; height:10px; background:${colors.won}; border-radius:2px; margin-right:5px;"></span>Won</span>
      <span><span style="display:inline-block; width:10px; height:10px; background:${colors.lost}; border-radius:2px; margin-right:5px;"></span>Lost</span>
    </div>
    <div style="position:relative;">
      <svg viewBox="0 0 900 260" style="width:100%; height:auto; display:block;">${gridLines}${bars}</svg>
      <div class="chart-tooltip" style="display:none; position:absolute; pointer-events:none; background:var(--ink); color:var(--bg-raised); font-size:12px; padding:6px 10px; border-radius:6px; white-space:nowrap; box-shadow:0 2px 8px rgba(0,0,0,0.2); z-index:10;"></div>
    </div>`;
}

function renderGroupedChart(wrap) {
  const { months, keys } = computeMonthlyRevenueData();
  if (!keys.length) { wrap.innerHTML = `<div class="task-empty">No quotes yet.</div>`; return; }
  const rawMax = Math.max(1, ...keys.flatMap((k) => [months[k].pending, months[k].won, months[k].lost]));
  const { niceMax, step } = computeNiceAxis(rawMax, 5);
  const padLeft = 50, padBottom = 40, padTop = 24, padRight = 10, plotW = 900 - padLeft - padRight, plotH = 260 - padTop - padBottom;
  const groupW = plotW / keys.length, barW = Math.min(22, groupW / 4.5), gap = 4;

  const gridLines = [0, 1, 2, 3, 4].map((i) => {
    const val = step * i, f = niceMax > 0 ? val / niceMax : 0, y = padTop + plotH * (1 - f);
    return `<line x1="${padLeft}" y1="${y}" x2="${900 - padRight}" y2="${y}" stroke="var(--line)"/><text x="${padLeft - 8}" y="${y + 4}" text-anchor="end" font-size="10" fill="var(--ink-soft)">${formatAxisValue(val)}</text>`;
  }).join("");
  const bars = keys.map((k, i) => {
    const groupX = padLeft + i * groupW + (groupW - (barW * 3 + gap * 2)) / 2, m = months[k];
    const parts = ["pending", "won", "lost"].map((status, j) => {
      const val = m[status], h = (val / niceMax) * plotH, x = groupX + j * (barW + gap), y = padTop + plotH - h;
      const rect = `<rect class="report-chart-bar" x="${x}" y="${y}" width="${barW}" height="${Math.max(h, val > 0 ? 2 : 0)}" fill="${COLORS[status]}" rx="2" data-tooltip="${esc(m.label)} \u00b7 ${status[0].toUpperCase() + status.slice(1)}: ${money(val)}"></rect>`;
      const label = val > 0 ? `<text x="${x + barW / 2}" y="${y - 5}" text-anchor="middle" font-size="9" font-weight="700" fill="var(--ink)" pointer-events="none">${formatAxisValue(val)}</text>` : "";
      return rect + label;
    }).join("");
    return `${parts}<text x="${padLeft + i * groupW + groupW / 2}" y="${260 - padBottom + 16}" text-anchor="middle" font-size="10.5" fill="var(--ink-soft)">${esc(m.label)}</text>`;
  }).join("");
  wrap.innerHTML = chartShell(COLORS, gridLines, bars);
  wireChartBarTooltips(wrap);
}

function renderStackedChart(wrap) {
  const { months, keys } = computeMonthlyRevenueData();
  if (!keys.length) { wrap.innerHTML = `<div class="task-empty">No quotes yet.</div>`; return; }
  const totals = keys.map((k) => months[k].pending + months[k].won + months[k].lost);
  const { niceMax, step } = computeNiceAxis(Math.max(1, ...totals), 5);
  const padLeft = 60, padBottom = 40, padTop = 24, padRight = 10, plotW = 900 - padLeft - padRight, plotH = 260 - padTop - padBottom;
  const groupW = plotW / keys.length, barW = Math.min(48, groupW * 0.5);
  const gridLines = [0, 1, 2, 3, 4].map((i) => {
    const val = step * i, f = niceMax > 0 ? val / niceMax : 0, y = padTop + plotH * (1 - f);
    return `<line x1="${padLeft}" y1="${y}" x2="${900 - padRight}" y2="${y}" stroke="var(--line)"/><text x="${padLeft - 8}" y="${y + 4}" text-anchor="end" font-size="10" fill="var(--ink-soft)">${formatAxisValue(val)}</text>`;
  }).join("");
  const bars = keys.map((k, i) => {
    const m = months[k], x = padLeft + i * groupW + (groupW - barW) / 2;
    let cumulative = 0;
    const segs = ["pending", "won", "lost"].map((status) => {
      const val = m[status]; if (val <= 0) return "";
      const h = (val / niceMax) * plotH, y = padTop + plotH - cumulative - h; cumulative += h;
      const rect = `<rect class="report-chart-bar" x="${x}" y="${y}" width="${barW}" height="${h}" fill="${COLORS[status]}" data-tooltip="${esc(m.label)} \u00b7 ${status[0].toUpperCase() + status.slice(1)}: ${money(val)}"></rect>`;
      const label = h >= 16 ? `<text x="${x + barW / 2}" y="${y + h / 2 + 3.5}" text-anchor="middle" font-size="9.5" font-weight="700" fill="${LABEL_TEXT_COLOR[status]}" pointer-events="none">${formatAxisValue(val)}</text>` : "";
      return rect + label;
    }).join("");
    const total = totals[i];
    const totalLabel = total > 0 ? `<text x="${x + barW / 2}" y="${padTop + plotH - cumulative - 6}" text-anchor="middle" font-size="10.5" font-weight="700" fill="var(--ink)" pointer-events="none">${formatAxisValue(total)}</text>` : "";
    return `${segs}${totalLabel}<text x="${padLeft + i * groupW + groupW / 2}" y="${260 - padBottom + 16}" text-anchor="middle" font-size="10.5" fill="var(--ink-soft)">${esc(m.label)}</text>`;
  }).join("");
  wrap.innerHTML = chartShell(COLORS, gridLines, bars);
  wireChartBarTooltips(wrap);
}

function renderPercentChart(wrap) {
  const { months, keys } = computeMonthlyRevenueData();
  if (!keys.length) { wrap.innerHTML = `<div class="task-empty">No quotes yet.</div>`; return; }
  const padLeft = 50, padBottom = 40, padTop = 10, padRight = 10, plotW = 900 - padLeft - padRight, plotH = 260 - padTop - padBottom;
  const groupW = plotW / keys.length, barW = Math.min(48, groupW * 0.5);
  const gridLines = [0, 25, 50, 75, 100].map((pct) => {
    const y = padTop + plotH * (1 - pct / 100);
    return `<line x1="${padLeft}" y1="${y}" x2="${900 - padRight}" y2="${y}" stroke="var(--line)"/><text x="${padLeft - 8}" y="${y + 4}" text-anchor="end" font-size="10" fill="var(--ink-soft)">${pct}%</text>`;
  }).join("");
  const bars = keys.map((k, i) => {
    const m = months[k], total = m.pending + m.won + m.lost, x = padLeft + i * groupW + (groupW - barW) / 2, labelX = padLeft + i * groupW + groupW / 2;
    if (total <= 0) return `<text x="${labelX}" y="${260 - padBottom + 16}" text-anchor="middle" font-size="10.5" fill="var(--ink-soft)">${esc(m.label)}</text>`;
    let cumulative = 0;
    const segs = ["pending", "won", "lost"].map((status) => {
      const val = m[status]; if (val <= 0) return "";
      const pct = (val / total) * 100, h = (pct / 100) * plotH, y = padTop + plotH - cumulative - h; cumulative += h;
      const rect = `<rect class="report-chart-bar" x="${x}" y="${y}" width="${barW}" height="${h}" fill="${COLORS[status]}" data-tooltip="${esc(m.label)} \u00b7 ${status[0].toUpperCase() + status.slice(1)}: ${pct.toFixed(0)}% (${money(val)})"></rect>`;
      const label = h >= 16 ? `<text x="${x + barW / 2}" y="${y + h / 2 + 3.5}" text-anchor="middle" font-size="9.5" font-weight="700" fill="${LABEL_TEXT_COLOR[status]}" pointer-events="none">${pct.toFixed(0)}%</text>` : "";
      return rect + label;
    }).join("");
    return `${segs}<text x="${labelX}" y="${260 - padBottom + 16}" text-anchor="middle" font-size="10.5" fill="var(--ink-soft)">${esc(m.label)}</text>`;
  }).join("");
  wrap.innerHTML = chartShell(COLORS, gridLines, bars);
  wireChartBarTooltips(wrap);
}

export function renderReportChart() {
  const wrap = document.getElementById("reportChartContainer");
  const sub = document.getElementById("reportChartSub");
  if (!wrap) return;
  if (state.reportChartType === "stacked") { sub.textContent = "Pending, Won, and Lost stacked to show the total value in play each month."; renderStackedChart(wrap); }
  else if (state.reportChartType === "percent") { sub.textContent = "Same totals, shown as a share of each month's quotes."; renderPercentChart(wrap); }
  else { sub.textContent = "Pending uses each quote's saved date; Won/Lost use the date it was marked."; renderGroupedChart(wrap); }
}

export function wireChartToggle() {
  document.querySelectorAll("#reportChartTypeToggle td").forEach((cell) => {
    cell.onclick = () => {
      state.reportChartType = cell.dataset.type;
      document.querySelectorAll("#reportChartTypeToggle td").forEach((c) => c.classList.toggle("active", c === cell));
      renderReportChart();
    };
  });
}

function catalogDefaultHours(t) {
  if (t.hoursByRole && Object.keys(t.hoursByRole).length) {
    const vals = Object.values(t.hoursByRole);
    return vals.reduce((s, v) => s + (Number(v) || 0), 0) / vals.length;
  }
  return t.defaultHours || 0; // fallback for tasks seeded before per-role hours existed
}

export function computeTaskHoursComparison() {
  const rows = {}; // "category::task" -> { category, task, defaultHours, entries: [{clientName, hours, savedAt}] }

  // Seed with the current task catalog so tasks with no usage yet still show their default.
  Object.values(state.taskCatalog || {}).forEach((t) => {
    const key = `${t.category}::${t.task}`;
    rows[key] = { category: t.category, task: t.task, defaultHours: catalogDefaultHours(t), entries: [] };
  });

  Object.values(state.quotes).forEach((q) => {
    (q.items || []).forEach((it) => {
      if (!it.role || !(Number(it.hours) > 0)) return; // only tasks actually worked (assigned + hours > 0)
      const key = `${it.category}::${it.task}`;
      if (!rows[key]) rows[key] = { category: it.category, task: it.task, defaultHours: 0, entries: [] };
      rows[key].entries.push({ clientName: q.clientName, hours: Number(it.hours), savedAt: q.savedAt });
    });
  });

  return Object.values(rows).sort((a, b) => a.category.localeCompare(b.category) || a.task.localeCompare(b.task));
}

function buildDeviationBar(variancePct, varianceColor) {
  if (variancePct === null) return "\u2014";
  const capped = Math.max(-100, Math.min(100, variancePct));
  const fillWidth = Math.abs(capped) / 2; // bar extends from the center, so max half-width
  const side = capped >= 0 ? `left:50%;` : `right:50%;`;
  const pctStr = (variancePct > 0 ? "+" : "") + variancePct.toLocaleString("nl-NL", { maximumFractionDigits: 0 }) + "%";
  return `<div style="display:flex; align-items:center; gap:8px; justify-content:center;">
    <div style="position:relative; width:56px; height:6px; background:var(--line); border-radius:3px; flex-shrink:0;">
      <div style="position:absolute; top:0; height:6px; border-radius:3px; ${side} width:${fillWidth}%; background:${varianceColor};"></div>
    </div>
    <span style="font-size:11px; color:${varianceColor}; width:36px; text-align:left;">${pctStr}</span>
  </div>`;
}

export function renderHoursComparison() {
  const body = document.getElementById("hoursComparisonBody");
  if (!body) return;
  const allRows = computeTaskHoursComparison().filter((r) => r.entries.length > 0); // hide tasks never used in a quote
  if (!allRows.length) { body.innerHTML = `<tr><td colspan="6" class="task-empty">No tasks used in any quote yet.</td></tr>`; return; }

  // Attach avg actual + variance up front so we can rank by it.
  const withStats = allRows.map((r) => {
    const avgActual = r.entries.reduce((s, e) => s + e.hours, 0) / r.entries.length;
    const variance = avgActual - r.defaultHours;
    return { ...r, avgActual, variance };
  });

  const canonicalOrder = CATEGORIES();
  const categories = [...new Set(withStats.map((r) => r.category))]
    .sort((a, b) => {
      const ai = canonicalOrder.indexOf(a), bi = canonicalOrder.indexOf(b);
      if (ai === -1 && bi === -1) return a.localeCompare(b);
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      return ai - bi;
    });

  body.innerHTML = categories.map((category) => {
    const rowsInCat = withStats
      .filter((r) => r.category === category)
      .sort((a, b) => Math.abs(a.variance) - Math.abs(b.variance)); // smallest deviation first

    const isCatOpen = state.expandedHoursDisciplines.has(category);
    const totalDefault = rowsInCat.reduce((s, r) => s + r.defaultHours, 0);
    const totalActual = rowsInCat.reduce((s, r) => s + r.avgActual, 0);
    const totalVariance = totalActual - totalDefault;
    const totalVariancePct = totalDefault > 0 ? (totalVariance / totalDefault) * 100 : null;
    const totalVarianceColor = totalVariance > 0 ? "var(--rose)" : totalVariance < 0 ? "var(--accent)" : "var(--ink-soft)";
    const totalVarianceStr = (totalVariance > 0 ? "+" : "") + totalVariance.toLocaleString("nl-NL", { maximumFractionDigits: 1 });

    const headerRow = `<tr class="hours-discipline-header" data-category="${esc(category)}" style="cursor:pointer;">
      <td style="font-weight:700; color:var(--accent); padding-top:14px;"><span style="display:inline-block; width:14px;">${isCatOpen ? "\u25be" : "\u25b8"}</span>${esc(category)}</td>
      <td class="numc" style="padding-top:14px; font-weight:700; color:var(--accent);">${totalDefault.toLocaleString("nl-NL", { maximumFractionDigits: 1 })}</td>
      <td class="numc" style="padding-top:14px; font-weight:700; color:var(--accent);">${totalActual.toLocaleString("nl-NL", { maximumFractionDigits: 1 })}</td>
      <td class="numc" style="padding-top:14px;"></td>
      <td class="numc" style="padding-top:14px; font-weight:700; color:${totalVarianceColor};">${totalVarianceStr}</td>
      <td class="numc" style="padding-top:14px;">${buildDeviationBar(totalVariancePct, totalVarianceColor)}</td>
    </tr>`;

    if (!isCatOpen) return headerRow;

    const taskRows = rowsInCat.map((r) => {
      const key = `${r.category}::${r.task}`;
      const isOpen = state.expandedHoursComparisonTasks.has(key);
      const { avgActual, variance } = r;
      const variancePct = r.defaultHours > 0 ? (variance / r.defaultHours) * 100 : null;
      const varianceStr = (variance > 0 ? "+" : "") + variance.toLocaleString("nl-NL", { maximumFractionDigits: 1 });
      const varianceColor = variance > 0 ? "var(--rose)" : variance < 0 ? "var(--accent)" : "var(--ink-soft)";

      const mainRow = `<tr class="summary-cat-row hours-comparison-row" data-key="${esc(key)}" style="cursor:pointer;">
        <td style="padding-left:26px;"><span style="display:inline-block; width:14px;">${isOpen ? "\u25be" : "\u25b8"}</span>${esc(r.task)}</td>
        <td class="numc">${r.defaultHours.toLocaleString("nl-NL")}</td>
        <td class="numc">${avgActual.toLocaleString("nl-NL", { maximumFractionDigits: 1 })}</td>
        <td class="numc">${r.entries.length}</td>
        <td class="numc" style="color:${varianceColor};">${varianceStr}</td>
        <td class="numc">${buildDeviationBar(variancePct, varianceColor)}</td>
      </tr>`;
      if (!isOpen) return mainRow;
      const detailRows = r.entries.map((e) => {
        const entryVariance = e.hours - r.defaultHours;
        const entryVariancePct = r.defaultHours > 0 ? (entryVariance / r.defaultHours) * 100 : null;
        const entryVarianceColor = entryVariance > 0 ? "var(--rose)" : entryVariance < 0 ? "var(--accent)" : "var(--ink-soft)";
        const entryVarianceStr = (entryVariance > 0 ? "+" : "") + entryVariance.toLocaleString("nl-NL", { maximumFractionDigits: 1 });
        return `<tr class="summary-task-row">
          <td style="padding-left:40px; font-size:12.5px; color:var(--ink-soft);">${esc(e.clientName || "(no client name)")} \u00b7 ${formatDate(e.savedAt)}</td>
          <td class="numc" style="font-size:12.5px; color:var(--ink-soft);">${r.defaultHours.toLocaleString("nl-NL")}</td>
          <td class="numc" style="font-size:12.5px; color:var(--ink-soft);">${e.hours.toLocaleString("nl-NL")}</td>
          <td></td>
          <td class="numc" style="font-size:12.5px; color:${entryVarianceColor};">${entryVarianceStr}</td>
          <td class="numc" style="font-size:12.5px;">${buildDeviationBar(entryVariancePct, entryVarianceColor)}</td>
        </tr>`;
      }).join("");
      return mainRow + detailRows;
    }).join("");

    return headerRow + taskRows;
  }).join("");

  body.querySelectorAll(".hours-discipline-header").forEach((tr) => {
    tr.onclick = () => {
      const category = tr.dataset.category;
      if (state.expandedHoursDisciplines.has(category)) state.expandedHoursDisciplines.delete(category);
      else state.expandedHoursDisciplines.add(category);
      renderHoursComparison();
    };
  });

  body.querySelectorAll(".hours-comparison-row").forEach((tr) => {
    tr.onclick = () => {
      const key = tr.dataset.key;
      if (state.expandedHoursComparisonTasks.has(key)) state.expandedHoursComparisonTasks.delete(key);
      else state.expandedHoursComparisonTasks.add(key);
      renderHoursComparison();
    };
  });
}

export function computeNeverUsedByDiscipline() {
  const unused = computeTaskHoursComparison().filter((r) => r.entries.length === 0);
  const canonicalOrder = CATEGORIES();
  const byCategory = {};
  unused.forEach((r) => {
    byCategory[r.category] = byCategory[r.category] || [];
    byCategory[r.category].push(r.task);
  });
  return Object.keys(byCategory)
    .sort((a, b) => {
      const ai = canonicalOrder.indexOf(a), bi = canonicalOrder.indexOf(b);
      if (ai === -1 && bi === -1) return a.localeCompare(b);
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      return ai - bi;
    })
    .map((category) => {
      const totalInCategory = Object.values(state.taskCatalog || {}).filter((t) => t.category === category).length;
      return { category, tasks: byCategory[category], allUnused: byCategory[category].length === totalInCategory && totalInCategory > 0 };
    });
}

export function renderNeverUsedSection() {
  const el = document.getElementById("neverUsedTasks");
  if (!el) return;
  const groups = computeNeverUsedByDiscipline();
  if (!groups.length) { el.innerHTML = `<div class="task-empty">Every task has been used in at least one quote.</div>`; return; }
  el.innerHTML = groups.map((g) => `<div style="margin-bottom:16px;">
    <div style="font-weight:700; color:var(--accent); margin-bottom:6px;">${esc(g.category)}${g.allUnused ? ` <span class="sub" style="color:var(--rose); font-weight:600;">\u2014 no tasks in this discipline have been quoted yet</span>` : ""}</div>
    <div class="chips small">${g.tasks.map((t) => `<span class="chip" style="cursor:default;">${esc(t)}</span>`).join("")}</div>
  </div>`).join("");
}

function computeHoursPerRoleByMonth() {
  const months = {}; // key -> { label, byRoleHours: {role: hours}, byRoleRevenue: {role: euros} }
  Object.values(state.quotes || {}).filter((q) => q.status === "won").forEach((q) => {
    const d = q.savedAt ? new Date(q.savedAt) : null;
    if (!d || isNaN(d)) return;
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    if (!months[key]) months[key] = { label: d.toLocaleDateString(undefined, { year: "numeric", month: "short" }), byRoleHours: {}, byRoleRevenue: {} };
    (q.items || []).forEach((it) => {
      if (!it.role || !(Number(it.hours) > 0)) return;
      const hrs = Number(it.hours);
      months[key].byRoleHours[it.role] = (months[key].byRoleHours[it.role] || 0) + hrs;
      months[key].byRoleRevenue[it.role] = (months[key].byRoleRevenue[it.role] || 0) + hrs * rateForRole(it.role);
    });
  });
  const keys = Object.keys(months).sort().slice(-12);

  const totalsByRole = {};
  keys.forEach((k) => {
    Object.entries(months[k].byRoleHours).forEach(([role, hrs]) => { totalsByRole[role] = (totalsByRole[role] || 0) + hrs; });
  });
  const roles = Object.keys(totalsByRole).sort((a, b) => totalsByRole[b] - totalsByRole[a]);

  return { months, keys, roles };
}

function metricValue(monthEntry, role) {
  const bucket = state.hoursPerRoleMetric === "revenue" ? monthEntry.byRoleRevenue : monthEntry.byRoleHours;
  return bucket[role] || 0;
}
function metricLabel(val) {
  return state.hoursPerRoleMetric === "revenue" ? money(val) : val.toLocaleString("nl-NL") + "h";
}
function metricAxisLabel(val) {
  return state.hoursPerRoleMetric === "revenue" ? formatAxisValue(val) : val.toLocaleString("nl-NL") + "h";
}
function metricLabelCompact(val, withCurrency) {
  return state.hoursPerRoleMetric === "revenue" ? formatAxisValue(val, withCurrency) : val.toLocaleString("nl-NL") + "h";
}
function buildBarLabel(x, barW, y, h, val, fontSize, insideTextColor) {
  if (val <= 0) return "";
  const label = metricLabelCompact(val, false); // no currency symbol, ever
  const estLabelLength = label.length * fontSize * 0.62 + 4; // rough estimate of the rotated text's length
  const cx = x + barW / 2;
  const fitsInside = h >= estLabelLength;
  if (fitsInside) {
    const cy = y + estLabelLength / 2 + 3; // anchored near the top of the column, text runs down into it
    return `<text x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="middle" font-size="${fontSize}" font-weight="700" fill="${insideTextColor || "#1C1B33"}" pointer-events="none" transform="rotate(90 ${cx} ${cy})">${label}</text>`;
  }
  const cy = y - 5;
  return `<text x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="middle" font-size="${fontSize}" font-weight="700" fill="var(--ink)" pointer-events="none" transform="rotate(90 ${cx} ${cy})">${label}</text>`;
}

function renderMultiRoleChart(wrap, months, keys, rolesToShow, padLeft, padBottom, padTop, padRight, plotW, plotH, groupW) {
  const rawMax = Math.max(1, ...keys.flatMap((k) => rolesToShow.map((r) => metricValue(months[k], r))));
  const { niceMax, step } = computeNiceAxis(rawMax, 5);
  const barW = Math.min(rolesToShow.length <= 2 ? 40 : 16, (groupW - 6) / Math.max(1, rolesToShow.length)), gap = rolesToShow.length <= 2 ? 6 : 3;
  const gridLines = [0, 1, 2, 3, 4].map((i) => {
    const val = step * i, f = niceMax > 0 ? val / niceMax : 0, y = padTop + plotH * (1 - f);
    return `<line x1="${padLeft}" y1="${y}" x2="${900 - padRight}" y2="${y}" stroke="var(--line)"/><text x="${padLeft - 8}" y="${y + 4}" text-anchor="end" font-size="10" fill="var(--ink-soft)">${metricAxisLabel(val)}</text>`;
  }).join("");
  const clusterW = rolesToShow.length * barW + (rolesToShow.length - 1) * gap;
  const bars = keys.map((k, i) => {
    const m = months[k];
    const groupX = padLeft + i * groupW + (groupW - clusterW) / 2;
    const parts = rolesToShow.map((role, j) => {
      const val = metricValue(m, role);
      if (val <= 0) return "";
      const color = roleColorFor(role);
      const h = (val / niceMax) * plotH, x = groupX + j * (barW + gap), y = padTop + plotH - h;
      const rect = `<rect class="report-chart-bar" x="${x}" y="${y}" width="${barW}" height="${h}" fill="${color}" rx="2" data-tooltip="${esc(m.label)} \u00b7 ${esc(role)}: ${metricLabel(val)}"></rect>`;
      const fontSize = rolesToShow.length <= 2 ? 10 : 8;
      const label = buildBarLabel(x, barW, y, h, val, fontSize, roleLabelTextColorFor(role));
      return rect + label;
    }).join("");
    return `${parts}<text x="${padLeft + i * groupW + groupW / 2}" y="${260 - padBottom + 16}" text-anchor="middle" font-size="10.5" fill="var(--ink-soft)">${esc(m.label)}</text>`;
  }).join("");
  const legend = rolesToShow.map((r) => `<span><span style="display:inline-block; width:10px; height:10px; background:${roleColorFor(r)}; border-radius:2px; margin-right:5px;"></span>${esc(r)}</span>`).join("");
  wrap.innerHTML = `<div style="display:flex; gap:14px; margin-bottom:8px; font-size:12px; color:var(--ink-soft); flex-wrap:wrap;">${legend}</div>
    <div style="position:relative;">
      <svg viewBox="0 0 900 260" style="width:100%; height:auto; display:block;">${gridLines}${bars}</svg>
      <div class="chart-tooltip" style="display:none; position:absolute; pointer-events:none; background:var(--ink); color:var(--bg-raised); font-size:12px; padding:6px 10px; border-radius:6px; white-space:nowrap; box-shadow:0 2px 8px rgba(0,0,0,0.2); z-index:10;"></div>
    </div>`;
  wireChartBarTooltips(wrap);
}

export function populateHoursPerRoleSelect() {
  const select = document.getElementById("hoursPerRoleSelect");
  const compareSelect = document.getElementById("hoursPerRoleCompareSelect");
  const compareLabel = document.getElementById("hoursPerRoleCompareLabel");
  if (!select) return;
  const { roles } = computeHoursPerRoleByMonth();
  const current = select.value;
  select.innerHTML = `<option value="">All roles</option>` + roles.map((r) => `<option value="${esc(r)}">${esc(r)}</option>`).join("");
  if (roles.includes(current)) select.value = current;

  if (compareSelect) {
    const currentCompare = compareSelect.value;
    const compareOptions = roles.filter((r) => r !== select.value);
    compareSelect.innerHTML = `<option value="">Compare to\u2026</option>` + compareOptions.map((r) => `<option value="${esc(r)}">${esc(r)}</option>`).join("");
    if (compareOptions.includes(currentCompare)) compareSelect.value = currentCompare;
    const showCompare = !!select.value;
    compareSelect.style.display = showCompare ? "" : "none";
    if (compareLabel) compareLabel.style.display = showCompare ? "" : "none";
  }
}

export function renderHoursPerRoleChart() {
  const wrap = document.getElementById("hoursPerRoleChart");
  if (!wrap) return;
  const select = document.getElementById("hoursPerRoleSelect");
  const compareSelect = document.getElementById("hoursPerRoleCompareSelect");
  const selectedRole = select ? select.value : "";
  const compareRole = compareSelect && compareSelect.style.display !== "none" ? compareSelect.value : "";
  const { months, keys, roles } = computeHoursPerRoleByMonth();
  if (!keys.length) { wrap.innerHTML = `<div class="task-empty">No quotes yet.</div>`; return; }

  const padLeft = 50, padBottom = 40, padTop = 24, padRight = 10, plotW = 900 - padLeft - padRight, plotH = 260 - padTop - padBottom;
  const groupW = plotW / keys.length;

  if (selectedRole && compareRole) {
    renderMultiRoleChart(wrap, months, keys, [selectedRole, compareRole], padLeft, padBottom, padTop, padRight, plotW, plotH, groupW);
    return;
  }

  if (selectedRole) {
    const color = roleColorFor(selectedRole);
    const rawMax = Math.max(1, ...keys.map((k) => metricValue(months[k], selectedRole)));
    const { niceMax, step } = computeNiceAxis(rawMax, 5);
    const barW = Math.min(48, groupW * 0.5);
    const gridLines = [0, 1, 2, 3, 4].map((i) => {
      const val = step * i, f = niceMax > 0 ? val / niceMax : 0, y = padTop + plotH * (1 - f);
      return `<line x1="${padLeft}" y1="${y}" x2="${900 - padRight}" y2="${y}" stroke="var(--line)"/><text x="${padLeft - 8}" y="${y + 4}" text-anchor="end" font-size="10" fill="var(--ink-soft)">${metricAxisLabel(val)}</text>`;
    }).join("");
    const bars = keys.map((k, i) => {
      const m = months[k], val = metricValue(m, selectedRole), x = padLeft + i * groupW + (groupW - barW) / 2;
      const h = (val / niceMax) * plotH, y = padTop + plotH - h;
      const rect = val > 0 ? `<rect class="report-chart-bar" x="${x}" y="${y}" width="${barW}" height="${h}" fill="${color}" rx="2" data-tooltip="${esc(m.label)} \u00b7 ${esc(selectedRole)}: ${metricLabel(val)}"></rect>` : "";
      const label = buildBarLabel(x, barW, y, h, val, 10.5, roleLabelTextColorFor(selectedRole));
      return `${rect}${label}<text x="${padLeft + i * groupW + groupW / 2}" y="${260 - padBottom + 16}" text-anchor="middle" font-size="10.5" fill="var(--ink-soft)">${esc(m.label)}</text>`;
    }).join("");
    wrap.innerHTML = `<div style="position:relative;"><svg viewBox="0 0 900 260" style="width:100%; height:auto; display:block;">${gridLines}${bars}</svg><div class="chart-tooltip" style="display:none; position:absolute; pointer-events:none; background:var(--ink); color:var(--bg-raised); font-size:12px; padding:6px 10px; border-radius:6px; white-space:nowrap; box-shadow:0 2px 8px rgba(0,0,0,0.2); z-index:10;"></div></div>`;
    wireChartBarTooltips(wrap);
    return;
  }

  renderMultiRoleChart(wrap, months, keys, roles, padLeft, padBottom, padTop, padRight, plotW, plotH, groupW);
}

export function wireHoursPerRoleSelect() {
  const select = document.getElementById("hoursPerRoleSelect");
  const compareSelect = document.getElementById("hoursPerRoleCompareSelect");
  const metricToggle = document.getElementById("hoursPerRoleMetricToggle");
  if (select) {
    select.addEventListener("change", () => {
      populateHoursPerRoleSelect(); // refresh compare options + visibility for the new primary role
      renderHoursPerRoleChart();
    });
  }
  if (compareSelect) compareSelect.addEventListener("change", renderHoursPerRoleChart);
  if (metricToggle) {
    metricToggle.querySelectorAll("td").forEach((cell) => {
      cell.onclick = () => {
        state.hoursPerRoleMetric = cell.dataset.metric;
        metricToggle.querySelectorAll("td").forEach((c) => c.classList.toggle("active", c === cell));
        renderHoursPerRoleChart();
      };
    });
  }
}

export function renderReport() {
  renderReportInsights();
  renderReportChart();
  renderHoursComparison();
  populateHoursPerRoleSelect();
  renderHoursPerRoleChart();
  renderNeverUsedSection();
}
