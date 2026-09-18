// A small reusable confirmation-modal system. Native confirm()/alert() are
// avoided intentionally: they didn't render reliably when this app lived as
// a Claude Artifact. Worth re-testing in a plain browser deployment, but
// there's no real downside to keeping a custom modal either way — it also
// looks nicer and can show richer messages.

let pendingAction = null;

export function ensureModalRoot() {
  if (document.getElementById("genericConfirmModalOverlay")) return;
  const div = document.createElement("div");
  div.innerHTML = `
    <div id="genericConfirmModalOverlay" class="modal-overlay" style="display:none;">
      <div class="modal-card">
        <h2 id="genericConfirmTitle" style="margin-bottom:10px;">Are you sure?</h2>
        <p class="sub" id="genericConfirmMessage" style="font-size:13px; line-height:1.5;"></p>
        <div class="row-actions" style="margin-top:18px;">
          <button class="btn ghost small" id="genericConfirmCancel">Cancel</button>
          <button class="btn primary small" id="genericConfirmConfirm" style="background:var(--rose);">Yes, continue</button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(div.firstElementChild);

  document.getElementById("genericConfirmCancel").onclick = closeConfirm;
  document.getElementById("genericConfirmConfirm").onclick = async () => {
    const action = pendingAction;
    if (!action) return closeConfirm();
    const btn = document.getElementById("genericConfirmConfirm");
    const original = btn.textContent;
    btn.textContent = "Working\u2026";
    btn.disabled = true;
    try {
      await action();
    } finally {
      btn.textContent = original;
      btn.disabled = false;
      closeConfirm();
    }
  };
  document.getElementById("genericConfirmModalOverlay").addEventListener("click", (e) => {
    if (e.target.id === "genericConfirmModalOverlay") closeConfirm();
  });
}

export function openConfirm(title, message, onConfirm, confirmLabel) {
  ensureModalRoot();
  pendingAction = onConfirm;
  document.getElementById("genericConfirmTitle").textContent = title;
  document.getElementById("genericConfirmMessage").textContent = message;
  document.getElementById("genericConfirmConfirm").textContent = confirmLabel || "Yes, continue";
  document.getElementById("genericConfirmModalOverlay").style.display = "flex";
}

export function closeConfirm() {
  pendingAction = null;
  const el = document.getElementById("genericConfirmModalOverlay");
  if (el) el.style.display = "none";
}
