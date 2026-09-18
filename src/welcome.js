import { db } from "./firebase-init.js";
import { state } from "./state.js";
import { esc, sortUsersRolandLast } from "./utils.js";

const ADMIN_SESSION_KEY = "sg_estimator_admin_unlocked";

export function loadStoredUser() {
  try {
    const match = document.cookie.match(/(?:^|; )estimatorUser=([^;]*)/);
    return match ? decodeURIComponent(match[1]) : null;
  } catch (e) { return null; }
}

function storeUser(name) {
  try {
    const oneYear = 60 * 60 * 24 * 365;
    document.cookie = `estimatorUser=${encodeURIComponent(name)}; path=/; max-age=${oneYear}; SameSite=Lax`;
  } catch (e) { /* cookies unavailable; keep in memory only */ }
}

try { state.isAdmin = sessionStorage.getItem(ADMIN_SESSION_KEY) === "1"; } catch (e) { state.isAdmin = false; }

export function renderCurrentUserIndicator() {
  const el = document.getElementById("currentUserIndicator");
  if (!el) return;
  el.innerHTML = state.currentUser
    ? `You are: <strong>${esc(state.currentUser)}</strong>${state.isAdmin ? " (Admin)" : ""} \u00b7 <a href="#" id="switchUserLink" style="color:var(--ink-soft);">Switch</a>`
    : "";
  const link = document.getElementById("switchUserLink");
  if (link) link.onclick = (e) => { e.preventDefault(); document.getElementById("welcomeOverlay").style.display = "flex"; };
  document.getElementById("adminNavBtn").style.display = state.isAdmin ? "" : "none";
}

export function setCurrentUser(name) {
  state.currentUser = name;
  storeUser(name);
  if (name !== "Roland") {
    state.isAdmin = false;
    try { sessionStorage.removeItem(ADMIN_SESSION_KEY); } catch (e) {}
  }
  document.getElementById("welcomeOverlay").style.display = "none";
  renderCurrentUserIndicator();
  window.dispatchEvent(new CustomEvent("user-selected"));
}

export function renderWelcomeUserList() {
  const wrap = document.getElementById("welcomeUserList");
  if (!wrap) return;
  const raw = (Array.isArray(state.settings.knownUsers) && state.settings.knownUsers.length)
    ? state.settings.knownUsers : ["Nick", "Desiree", "Roland"];
  const users = sortUsersRolandLast(raw);
  wrap.innerHTML = users.map((u) => `<button class="btn primary welcome-user-btn" data-user="${esc(u)}" style="padding:12px; font-size:14px;">${esc(u)}</button>`).join("");
  wrap.querySelectorAll(".welcome-user-btn").forEach((btn) => {
    btn.onclick = () => {
      if (btn.dataset.user === "Roland") {
        document.getElementById("welcomePinForm").style.display = "block";
        const pinInput = document.getElementById("welcomePinInput");
        pinInput.value = "";
        document.getElementById("welcomePinError").textContent = "";
        pinInput.focus();
      } else {
        document.getElementById("welcomePinForm").style.display = "none";
        setCurrentUser(btn.dataset.user);
      }
    };
  });
}

export function initWelcomeScreen() {
  renderWelcomeUserList();

  const stored = loadStoredUser();
  if (stored && (stored !== "Roland" || state.isAdmin)) {
    state.currentUser = stored;
    document.getElementById("welcomeOverlay").style.display = "none";
  }
  renderCurrentUserIndicator();

  document.getElementById("welcomePinSubmit").onclick = () => {
    const val = document.getElementById("welcomePinInput").value.trim();
    const err = document.getElementById("welcomePinError");
    if (val && val === String(state.settings.adminPin || "1234").trim()) {
      state.isAdmin = true;
      try { sessionStorage.setItem(ADMIN_SESSION_KEY, "1"); } catch (e) {}
      err.textContent = "";
      setCurrentUser("Roland");
    } else {
      err.textContent = "Incorrect PIN.";
    }
  };
  document.getElementById("welcomePinInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") document.getElementById("welcomePinSubmit").click();
  });

  document.getElementById("welcomeAddPersonToggle").onclick = () => {
    const form = document.getElementById("welcomeAddPersonForm");
    const showing = form.style.display !== "none";
    form.style.display = showing ? "none" : "flex";
    if (!showing) document.getElementById("welcomeNewPersonInput").focus();
  };
  document.getElementById("welcomeNewPersonSubmit").onclick = async () => {
    const input = document.getElementById("welcomeNewPersonInput");
    const name = input.value.trim();
    if (!name) return;
    const current = (Array.isArray(state.settings.knownUsers) && state.settings.knownUsers.length)
      ? state.settings.knownUsers : ["Nick", "Desiree", "Roland"];
    if (!current.includes(name)) {
      const updated = [...current, name];
      state.settings.knownUsers = updated;
      await db.doc("settings/main").update({ knownUsers: updated }).catch(() => {});
      renderWelcomeUserList();
    }
    input.value = "";
    document.getElementById("welcomeAddPersonForm").style.display = "none";
  };
  document.getElementById("welcomeNewPersonInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") document.getElementById("welcomeNewPersonSubmit").click();
  });
}
