const VIEWS = ["drafts", "estimator", "quotes", "report", "admin"];

// The persistent top menu doesn't have its own item for "estimator" (you get
// there by opening a draft, not by clicking a menu item), so map it to
// highlighting "New Quote" as the closest related destination.
const NAV_FOR_VIEW = { drafts: "newQuoteNavBtn", estimator: "newQuoteNavBtn", quotes: "quotesNavBtn", report: "reportNavBtn", admin: "adminNavBtn" };

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
