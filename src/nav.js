const VIEWS = ["drafts", "estimator", "quotes", "report", "admin"];

// The persistent top menu doesn't have its own item for "estimator" (you get
// there by opening a draft, not by clicking a menu item), so map it to
// highlighting "New Quote" as the closest related destination.
const NAV_FOR_VIEW = { drafts: "newQuoteNavBtn", estimator: "newQuoteNavBtn", quotes: "quotesNavBtn", report: "reportNavBtn", admin: "adminNavBtn" };

// Every static view gets its own URL path. "estimator" is special: since it
// always represents one specific open draft, its path carries the draft id
// (/estimator/{id}) rather than being a single fixed path like the others.
const VIEW_TO_PATH = { drafts: "/", quotes: "/quotes", report: "/report", admin: "/admin" };
const PATH_TO_VIEW = { "/": "drafts", "/quotes": "quotes", "/report": "report", "/admin": "admin" };

export function parseCurrentPath() {
  const path = window.location.pathname;
  const estimatorMatch = path.match(/^\/estimator\/(.+)$/);
  if (estimatorMatch) return { view: "estimator", draftId: decodeURIComponent(estimatorMatch[1]) };
  return { view: PATH_TO_VIEW[path] || "drafts", draftId: null };
}

const PAGE_COPY = {
  drafts: {
    title: "Client Work Estimator",
    subtitle: "Shared with your team. Multiple quotes can be in progress at once \u2014 everyone sees the same drafts list.",
  },
  estimator: {
    title: "Client Work Estimator",
    subtitle: "Shared with your team. Multiple quotes can be in progress at once \u2014 everyone sees the same drafts list.",
  },
  quotes: {
    title: "Quotes",
    subtitle: "Every quote your team has put together, all in one place. Search by client, revisit the full breakdown, and track whether each one was won or lost.",
  },
  report: {
    title: "Reporting",
    subtitle: "A living picture of the business behind the quotes \u2014 how much revenue is moving through the pipeline, how it's trending month over month, and where the wins and losses are landing. Everything here updates automatically as quotes get saved, edited, and marked Won or Lost, so it's always a current read on where things stand.",
  },
  admin: {
    title: "Client Work Estimator",
    subtitle: "Shared with your team. Multiple quotes can be in progress at once \u2014 everyone sees the same drafts list.",
  },
};

export function setStatus(text, isErr) {
  const el = document.getElementById("status");
  if (!el) return;
  el.textContent = text;
  el.className = "status" + (isErr ? " err" : "");
}

// options.draftId: for name === "estimator", which draft's URL to show.
// options.updateUrl: pass false when routing *from* a URL change (e.g. the
// initial load, or a popstate/back-button event) to avoid pushing a
// redundant history entry for a navigation that already happened.
// options.replace: use replaceState instead of pushState (used for the very
// first route on page load, so it doesn't leave a junk history entry).
export function showView(name, options = {}) {
  VIEWS.forEach((v) => {
    document.getElementById(v + "View").style.display = v === name ? "" : "none";
  });
  const copy = PAGE_COPY[name];
  if (copy) {
    document.getElementById("pageTitle").textContent = copy.title;
    document.getElementById("pageSubtitle").textContent = copy.subtitle;
  }
  document.querySelectorAll(".nav-menu-item").forEach((el) => el.classList.remove("active"));
  const activeId = NAV_FOR_VIEW[name];
  if (activeId) {
    const el = document.getElementById(activeId);
    if (el) el.classList.add("active");
  }

  if (options.updateUrl !== false) {
    const path = name === "estimator" && options.draftId ? `/estimator/${encodeURIComponent(options.draftId)}` : VIEW_TO_PATH[name];
    if (path && path !== window.location.pathname) {
      const state = { view: name, draftId: options.draftId || null };
      if (options.replace) history.replaceState(state, "", path);
      else history.pushState(state, "", path);
    }
  }

  window.dispatchEvent(new CustomEvent("view-shown", { detail: { name } }));
}

export function wireNav() {
  document.getElementById("logoLink").onclick = (e) => { e.preventDefault(); showView("drafts"); };
  document.getElementById("newQuoteNavBtn").onclick = (e) => { e.preventDefault(); showView("drafts"); };
  document.getElementById("quotesNavBtn").onclick = (e) => { e.preventDefault(); showView("quotes"); };
  document.getElementById("reportNavBtn").onclick = (e) => { e.preventDefault(); showView("report"); };
  document.getElementById("adminNavBtn").onclick = (e) => { e.preventDefault(); showView("admin"); };

  window.addEventListener("view-shown", (e) => {
    if (e.detail.name === "quotes" && window.__renderQuotesView) window.__renderQuotesView();
    if (e.detail.name === "report" && window.__renderReport) window.__renderReport();
    if (e.detail.name === "admin" && window.__renderAdminView) window.__renderAdminView();
  });
}
