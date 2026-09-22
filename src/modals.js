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

export function openConfirm(title, message, onConfirm, confirmLabel, confirmStyle) {
  ensureModalRoot();
  pendingAction = onConfirm;
  document.getElementById("genericConfirmTitle").textContent = title;
  document.getElementById("genericConfirmMessage").innerHTML = message;
  const confirmBtn = document.getElementById("genericConfirmConfirm");
  confirmBtn.textContent = confirmLabel || "Yes, continue";
  confirmBtn.style.background = confirmStyle === "primary" ? "" : "var(--rose)";
  document.getElementById("genericConfirmModalOverlay").style.display = "flex";
}

export function closeConfirm() {
  pendingAction = null;
  const el = document.getElementById("genericConfirmModalOverlay");
  if (el) el.style.display = "none";
}

// A small reusable text-input modal, for short one-field prompts (e.g. "add a
// to-do"). The input is visible and focused as soon as the modal opens \u2014
// no extra click needed to reveal it.
let pendingPromptAction = null;

let pendingPromptSecondaryAction = null;

export function ensurePromptModalRoot() {
  if (document.getElementById("genericPromptModalOverlay")) return;
  const div = document.createElement("div");
  div.innerHTML = `
    <div id="genericPromptModalOverlay" class="modal-overlay" style="display:none;">
      <div class="modal-card">
        <h2 id="genericPromptTitle" style="margin-bottom:10px;">Add</h2>
        <input type="text" id="genericPromptInput" style="width:100%; margin-top:4px;">
        <div class="row-actions" style="margin-top:18px; flex-wrap:wrap;">
          <button class="btn ghost small" id="genericPromptCancel">Cancel</button>
          <button class="btn ghost small" id="genericPromptSecondary" style="display:none;"></button>
          <button class="btn primary small" id="genericPromptConfirm">Add</button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(div.firstElementChild);

  document.getElementById("genericPromptCancel").onclick = closePrompt;

  const runAction = async (action, btnId) => {
    const input = document.getElementById("genericPromptInput");
    const value = input.value.trim();
    if (!value) { input.focus(); return; }
    if (!action) return closePrompt();
    const btn = document.getElementById(btnId);
    const original = btn.textContent;
    btn.textContent = "Working\u2026";
    btn.disabled = true;
    try {
      await action(value);
    } finally {
      btn.textContent = original;
      btn.disabled = false;
      closePrompt();
    }
  };

  document.getElementById("genericPromptConfirm").onclick = () => runAction(pendingPromptAction, "genericPromptConfirm");
  document.getElementById("genericPromptSecondary").onclick = () => runAction(pendingPromptSecondaryAction, "genericPromptSecondary");
  document.getElementById("genericPromptInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") document.getElementById("genericPromptConfirm").click();
    if (e.key === "Escape") closePrompt();
  });
  document.getElementById("genericPromptModalOverlay").addEventListener("click", (e) => {
    if (e.target.id === "genericPromptModalOverlay") closePrompt();
  });
}

// options: { confirmLabel, secondaryLabel, onSecondary }. The secondary
// button only shows when both secondaryLabel and onSecondary are given.
export function openPrompt(title, placeholder, onConfirm, options) {
  ensurePromptModalRoot();
  const opts = options || {};
  pendingPromptAction = onConfirm;
  pendingPromptSecondaryAction = opts.onSecondary || null;
  document.getElementById("genericPromptTitle").textContent = title;
  const input = document.getElementById("genericPromptInput");
  input.value = "";
  input.placeholder = placeholder || "";
  document.getElementById("genericPromptConfirm").textContent = opts.confirmLabel || "Add";
  const secondaryBtn = document.getElementById("genericPromptSecondary");
  if (opts.secondaryLabel && opts.onSecondary) {
    secondaryBtn.textContent = opts.secondaryLabel;
    secondaryBtn.style.display = "";
  } else {
    secondaryBtn.style.display = "none";
  }
  document.getElementById("genericPromptModalOverlay").style.display = "flex";
  setTimeout(() => input.focus(), 0);
}

export function closePrompt() {
  pendingPromptAction = null;
  const el = document.getElementById("genericPromptModalOverlay");
  if (el) el.style.display = "none";
}
