const VIEWS = ["drafts", "estimator", "quotes", "report", "admin"];

// The persistent top menu doesn't have its own item for "estimator" (you get
// there by opening a draft, not by clicking a menu item), so map it to
// highlighting "New Quote" as the closest related destination.
const NAV_FOR_VIEW = { drafts: "newQuoteNavBtn", estimator: "newQuoteNavBtn", quotes: "quotesNavBtn", report: "reportNavBtn", admin: "adminNavBtn" };

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

export function showView(name) {
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

  showView("drafts");
}
