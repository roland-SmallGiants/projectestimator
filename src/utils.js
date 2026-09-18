export function esc(s) {
  return (s == null ? "" : String(s)).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

export function formatCurrencyNumber(n) {
  let s = (Math.round(n * 100) / 100).toLocaleString("nl-NL", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (s.endsWith(",00")) s = s.slice(0, -2) + "--";
  return s;
}
export function money(n) { return "\u20ac " + formatCurrencyNumber(n); }
export function moneyPlain(n) { return formatCurrencyNumber(n); }

export function notesIcon(notes) {
  if (!notes) return "";
  return `<span class="notes-icon-wrap"><span class="notes-icon">\u24d8</span><span class="notes-tooltip">${esc(notes)}</span></span>`;
}

export function niceNumber(range, round) {
  if (range <= 0) return 1;
  const exponent = Math.floor(Math.log10(range));
  const fraction = range / Math.pow(10, exponent);
  let niceFraction;
  if (round) {
    if (fraction < 1.5) niceFraction = 1;
    else if (fraction < 3) niceFraction = 2;
    else if (fraction < 7) niceFraction = 5;
    else niceFraction = 10;
  } else {
    if (fraction <= 1) niceFraction = 1;
    else if (fraction <= 2) niceFraction = 2;
    else if (fraction <= 5) niceFraction = 5;
    else niceFraction = 10;
  }
  return niceFraction * Math.pow(10, exponent);
}

export function computeNiceAxis(maxVal, tickCount) {
  const numSteps = tickCount - 1;
  if (maxVal <= 0) return { niceMax: numSteps, step: 1 };
  const target = maxVal / numSteps;
  const exponent = Math.floor(Math.log10(target));
  const bases = [1, 2, 5, 10];
  let step = null;
  for (let e = exponent - 1; e <= exponent + 1 && step === null; e++) {
    for (const b of bases) {
      const candidate = b * Math.pow(10, e);
      if (candidate >= target - 1e-9) { step = candidate; break; }
    }
  }
  if (step === null) step = Math.pow(10, exponent + 1);
  return { niceMax: step * numSteps, step };
}

export function formatAxisValue(v, withCurrency = true) {
  const prefix = withCurrency ? "\u20ac" : "";
  if (v >= 1000000) { const m = v / 1000000; return prefix + (Number.isInteger(m) ? m : m.toFixed(1)) + "M"; }
  if (v >= 1000) { const k = v / 1000; return prefix + (Number.isInteger(k) ? k : k.toFixed(1)) + "K"; }
  return prefix + Math.round(v);
}

export function formatDateTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d)) return "";
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })
    + ", " + d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false });
}

export function formatDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d)) return "";
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export function sortUsersRolandLast(users) {
  return [...users].sort((a, b) => {
    if (a === "Roland") return 1;
    if (b === "Roland") return -1;
    return a.localeCompare(b);
  });
}

export function setButtonLoading(btn, isLoading, loadingText) {
  if (isLoading) {
    btn.dataset.originalText = btn.textContent;
    btn.textContent = loadingText || "Working\u2026";
    btn.disabled = true;
  } else {
    if (btn.dataset.originalText) btn.textContent = btn.dataset.originalText;
    btn.disabled = false;
  }
}

export function levenshtein(a, b) {
  a = a.toLowerCase(); b = b.toLowerCase();
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  const dp = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

export function normalizeClientName(name) {
  return name
    .trim()
    .replace(/\s+/g, " ")
    .split(" ")
    .map((w) => (w.length ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w))
    .join(" ");
}

const AVATAR_COLORS = ["#FFBA30", "#7CC6FE", "#F080A0", "#8FE3B0", "#C7A6FF", "#FFA26B"];
export function avatarColorFor(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) % AVATAR_COLORS.length;
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

export function wireAutocomplete(inputEl, dropdownEl, getOptions, onSelect) {
  function highlightMatch(name, query) {
    if (!query) return esc(name);
    const idx = name.toLowerCase().indexOf(query.toLowerCase());
    if (idx === -1) return esc(name);
    return esc(name.slice(0, idx)) + "<mark>" + esc(name.slice(idx, idx + query.length)) + "</mark>" + esc(name.slice(idx + query.length));
  }

  function render() {
    const query = inputEl.value.trim();
    const options = getOptions().filter((n) => !query || n.toLowerCase().includes(query.toLowerCase()));
    if (!options.length) { dropdownEl.classList.remove("open"); dropdownEl.innerHTML = ""; return; }
    dropdownEl.innerHTML = options.slice(0, 20)
      .map((n) => `<div class="autocomplete-item" data-value="${esc(n)}">${highlightMatch(n, query)}</div>`)
      .join("");
    dropdownEl.classList.add("open");
    dropdownEl.querySelectorAll(".autocomplete-item").forEach((item) => {
      item.onmousedown = (e) => {
        e.preventDefault(); // fires before the input's blur, so the click registers before the dropdown closes
        inputEl.value = item.dataset.value;
        dropdownEl.classList.remove("open");
        onSelect(item.dataset.value);
      };
    });
  }

  inputEl.addEventListener("focus", render);
  inputEl.addEventListener("input", render);
  inputEl.addEventListener("blur", () => {
    setTimeout(() => dropdownEl.classList.remove("open"), 100);
  });
}

export function uid() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}
