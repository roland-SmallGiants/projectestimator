const VIEWS = ["drafts", "estimator", "quotes", "report", "admin"];

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
  document.getElementById("backToDraftsBtn").style.display = name === "drafts" ? "none" : "";
  document.getElementById("quotesNavBtn").style.display = name === "quotes" ? "none" : "";
  document.getElementById("reportNavBtn").style.display = name === "report" ? "none" : "";
  window.dispatchEvent(new CustomEvent("view-shown", { detail: { name } }));
}

export function wireNav() {
  document.getElementById("backToDraftsBtn").onclick = () => showView("drafts");
  document.getElementById("quotesNavBtn").onclick = () => showView("quotes");
  document.getElementById("reportNavBtn").onclick = () => showView("report");
  document.getElementById("adminNavBtn").onclick = () => showView("admin");

  window.addEventListener("view-shown", (e) => {
    if (e.detail.name === "quotes" && window.__renderQuotesView) window.__renderQuotesView();
    if (e.detail.name === "report" && window.__renderReport) window.__renderReport();
    if (e.detail.name === "admin" && window.__renderAdminView) window.__renderAdminView();
  });

  showView("drafts");
}
