import { state } from "./state.js";
import { esc, money, computeNiceAxis, formatAxisValue } from "./utils.js";
import { buildArchiveRowHtml, wireArchiveRows } from "./quotes.js";

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
  const padLeft = 50, padBottom = 40, padTop = 10, padRight = 10, plotW = 900 - padLeft - padRight, plotH = 260 - padTop - padBottom;
  const groupW = plotW / keys.length, barW = Math.min(22, groupW / 4.5), gap = 4;

  const gridLines = [0, 1, 2, 3, 4].map((i) => {
    const val = step * i, f = niceMax > 0 ? val / niceMax : 0, y = padTop + plotH * (1 - f);
    return `<line x1="${padLeft}" y1="${y}" x2="${900 - padRight}" y2="${y}" stroke="var(--line)"/><text x="${padLeft - 8}" y="${y + 4}" text-anchor="end" font-size="10" fill="var(--ink-soft)">${formatAxisValue(val)}</text>`;
  }).join("");
  const bars = keys.map((k, i) => {
    const groupX = padLeft + i * groupW + (groupW - (barW * 3 + gap * 2)) / 2, m = months[k];
    const parts = ["pending", "won", "lost"].map((status, j) => {
      const val = m[status], h = (val / niceMax) * plotH, x = groupX + j * (barW + gap), y = padTop + plotH - h;
      return `<rect class="report-chart-bar" x="${x}" y="${y}" width="${barW}" height="${Math.max(h, val > 0 ? 2 : 0)}" fill="${COLORS[status]}" rx="2" data-tooltip="${esc(m.label)} \u00b7 ${status[0].toUpperCase() + status.slice(1)}: ${money(val)}"></rect>`;
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
  const padLeft = 60, padBottom = 40, padTop = 10, padRight = 10, plotW = 900 - padLeft - padRight, plotH = 260 - padTop - padBottom;
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
      return `<rect class="report-chart-bar" x="${x}" y="${y}" width="${barW}" height="${h}" fill="${COLORS[status]}" data-tooltip="${esc(m.label)} \u00b7 ${status[0].toUpperCase() + status.slice(1)}: ${money(val)}"></rect>`;
    }).join("");
    return `${segs}<text x="${padLeft + i * groupW + groupW / 2}" y="${260 - padBottom + 16}" text-anchor="middle" font-size="10.5" fill="var(--ink-soft)">${esc(m.label)}</text>`;
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
      return `<rect class="report-chart-bar" x="${x}" y="${y}" width="${barW}" height="${h}" fill="${COLORS[status]}" data-tooltip="${esc(m.label)} \u00b7 ${status[0].toUpperCase() + status.slice(1)}: ${pct.toFixed(0)}% (${money(val)})"></rect>`;
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
  document.querySelectorAll("#reportChartTypeToggle .chip").forEach((chip) => {
    chip.onclick = () => {
      state.reportChartType = chip.dataset.type;
      document.querySelectorAll("#reportChartTypeToggle .chip").forEach((c) => c.classList.toggle("on", c === chip));
      renderReportChart();
    };
  });
}

export function renderReportColumns() {
  const wrap = document.getElementById("reportColumns");
  if (!wrap) return;
  const columns = [
    { key: "pending", label: "Pending", accent: "var(--ink-soft)" },
    { key: "won", label: "Won", accent: "var(--accent)" },
    { key: "lost", label: "Lost", accent: "var(--rose)" },
  ];
  const grouped = { pending: [], won: [], lost: [] };
  Object.keys(state.quotes).forEach((id) => {
    const status = state.quotes[id].status === "won" || state.quotes[id].status === "lost" ? state.quotes[id].status : "pending";
    grouped[status].push(id);
  });
  Object.values(grouped).forEach((list) => list.sort((a, b) => new Date(state.quotes[b].savedAt) - new Date(state.quotes[a].savedAt)));

  wrap.innerHTML = columns.map((col) => {
    const list = grouped[col.key];
    const total = list.reduce((s, id) => s + (state.quotes[id].finalPrice || 0), 0);
    const rows = list.length ? `<div class="report-rows">${list.map((id) => buildArchiveRowHtml(id, true)).join("")}</div>` : `<div class="task-empty">No quotes here yet.</div>`;
    return `<div class="report-col"><h3 style="color:${col.accent};">${col.label}</h3><div class="report-col-total">${list.length} quote${list.length === 1 ? "" : "s"} \u00b7 ${money(total)}</div>${rows}</div>`;
  }).join("");
  wireArchiveRows(wrap, renderReportColumns);
}

export function renderReport() {
  renderReportInsights();
  renderReportChart();
  renderReportColumns();
}
