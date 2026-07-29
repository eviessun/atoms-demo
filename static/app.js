// Atoms Demo — frontend logic
// Wires the composer to /api/generate, renders returned HTML into the sandboxed
// preview iframe, and adds auth + a "My projects" list backed by the API.

const messagesEl = document.getElementById("messages");
const composer = document.getElementById("composer");
const promptEl = document.getElementById("prompt");
const sendBtn = document.getElementById("send");
const statusEl = document.getElementById("status");
const previewEl = document.getElementById("preview");
const previewPlaceholder = document.getElementById("preview-placeholder");
const providerBadge = document.getElementById("provider-badge");
const authBox = document.getElementById("auth-box");
const projectsList = document.getElementById("projects-list");
const refreshBtn = document.getElementById("refresh-projects");
const langToggle = document.getElementById("lang-toggle");

let currentUser = null;
let lastProjects = [];       // cache so we can re-render on language change
let statusKey = "status.idle";
let lastProviderLabel = null;

function addMessage(role, text) {
  const div = document.createElement("div");
  div.className = `msg ${role}`;
  const p = document.createElement("p");
  p.textContent = text;
  div.appendChild(p);
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function setStatus(key) {
  statusKey = key;
  statusEl.textContent = i18n.t(key);
}

// Swap the dark placeholder for the (white) iframe once we have content to show.
function showPreview(html) {
  previewEl.srcdoc = html;
  previewPlaceholder.classList.add("hidden");
  previewEl.classList.remove("hidden");
}

async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  let data = {};
  try { data = await res.json(); } catch { /* no body */ }
  return { ok: res.ok, status: res.status, data };
}

// --- auth UI -------------------------------------------------------------

function renderAuth() {
  authBox.innerHTML = "";
  if (currentUser) {
    const who = document.createElement("span");
    who.className = "who";
    who.textContent = currentUser.email;
    const out = document.createElement("button");
    out.className = "ghost";
    out.textContent = i18n.t("app.logout");
    out.onclick = logout;
    authBox.append(who, out);
  } else {
    const link = document.createElement("a");
    link.className = "login-entry";
    link.href = "/login";
    link.textContent = i18n.t("app.login_entry");
    authBox.append(link);
  }
}

async function logout() {
  await api("/api/auth/logout", { method: "POST" });
  currentUser = null;
  renderAuth();
  renderProjects([]);
}

async function loadMe() {
  const { data } = await api("/api/auth/me");
  currentUser = data.user;
  renderAuth();
}

// --- projects ------------------------------------------------------------

function renderProjects(items) {
  lastProjects = items || [];
  projectsList.innerHTML = "";
  if (!currentUser) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = i18n.t("app.projects_empty_guest");
    projectsList.appendChild(li);
    return;
  }
  if (!lastProjects.length) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = i18n.t("app.projects_empty_none");
    projectsList.appendChild(li);
    return;
  }
  for (const p of lastProjects) {
    const li = document.createElement("li");
    li.className = "item";
    const title = document.createElement("div");
    title.className = "title";
    title.textContent = p.prompt;
    const meta = document.createElement("div");
    meta.className = "meta";
    meta.textContent = `#${p.id} · ${p.provider} · ${p.created_at}`;
    li.append(title, meta);
    li.onclick = () => openProject(p.id);
    projectsList.appendChild(li);
  }
}

async function loadProjects() {
  if (!currentUser) { renderProjects([]); return; }
  const { ok, data } = await api("/api/projects");
  if (ok) renderProjects(data.projects || []);
}

async function openProject(id) {
  const { ok, data } = await api(`/api/projects/${id}`);
  if (!ok) { addMessage("assistant", i18n.t("msg.open_fail", { id })); return; }
  showPreview(data.html);
  setStatus("status.ready");
  addMessage("assistant", i18n.t("msg.loaded", { id, prompt: data.prompt }));
}

// --- generate ------------------------------------------------------------

async function loadHealth() {
  const { ok, data } = await api("/api/health");
  lastProviderLabel = ok ? data.llm_provider : "?";
  updateProviderBadge();
}

function updateProviderBadge() {
  providerBadge.textContent = `${i18n.t("app.provider")}: ${lastProviderLabel ?? "?"}`;
}

async function generate(prompt) {
  sendBtn.disabled = true;
  setStatus("status.generating");
  addMessage("assistant", i18n.t("msg.generating"));
  try {
    const { ok, status, data } = await api("/api/generate", {
      method: "POST",
      body: JSON.stringify({ prompt }),
    });
    if (!ok) throw new Error(data.error || `HTTP ${status}`);
    showPreview(data.html);
    setStatus("status.ready");
    const saved = data.project_id ? i18n.t("msg.saved_suffix", { id: data.project_id }) : "";
    addMessage("assistant", i18n.t("msg.done", { provider: data.provider, saved }));
    if (data.project_id) loadProjects();
  } catch (err) {
    setStatus("status.error");
    addMessage("assistant", i18n.t("msg.error", { msg: err.message }));
  } finally {
    sendBtn.disabled = false;
  }
}

composer.addEventListener("submit", (e) => {
  e.preventDefault();
  const prompt = promptEl.value.trim();
  if (!prompt) return;
  addMessage("user", prompt);
  promptEl.value = "";
  generate(prompt);
});

refreshBtn.addEventListener("click", loadProjects);
langToggle.addEventListener("click", () => i18n.toggle());

// --- resizable panels ----------------------------------------------------
// Drag the dividers to resize the chat / projects columns. The preview column
// takes the remaining space (grid `1fr`). Widths persist across reloads.

(function initResizers() {
  const layout = document.querySelector(".layout");
  if (!layout) return;

  const VARS = { chat: "--chat-w", projects: "--projects-w" };
  const MIN = { chat: 260, projects: 160 }; // px floor per panel
  const STORE_KEY = "atoms:panelWidths";

  // Restore saved widths.
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY) || "{}");
    for (const [target, cssVar] of Object.entries(VARS)) {
      if (typeof saved[target] === "number") {
        layout.style.setProperty(cssVar, `${saved[target]}px`);
      }
    }
  } catch { /* ignore malformed storage */ }

  function persist() {
    const out = {};
    for (const [target, cssVar] of Object.entries(VARS)) {
      const v = parseInt(getComputedStyle(layout).getPropertyValue(cssVar), 10);
      if (!Number.isNaN(v)) out[target] = v;
    }
    try { localStorage.setItem(STORE_KEY, JSON.stringify(out)); } catch { /* quota */ }
  }

  let active = null; // { target, cssVar, startX, startW, maxW }

  function onMove(e) {
    if (!active) return;
    const dx = e.clientX - active.startX;
    let w = active.startW + dx;
    w = Math.max(MIN[active.target], Math.min(w, active.maxW));
    layout.style.setProperty(active.cssVar, `${w}px`);
  }

  function onUp() {
    if (!active) return;
    active.el.classList.remove("dragging");
    document.body.classList.remove("resizing");
    active = null;
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    persist();
  }

  for (const el of document.querySelectorAll(".resizer")) {
    el.addEventListener("pointerdown", (e) => {
      const target = el.dataset.target;
      const cssVar = VARS[target];
      if (!cssVar) return;
      e.preventDefault();
      const startW = parseInt(getComputedStyle(layout).getPropertyValue(cssVar), 10) || 0;
      // The dragged panel may grow only until the preview column hits its 320px
      // floor, so it can gain at most (currentPreviewWidth - 320) pixels.
      const previewW = document.querySelector(".preview-panel").clientWidth;
      const maxW = startW + Math.max(0, previewW - 320);
      active = { target, cssVar, el, startX: e.clientX, startW, maxW };
      el.classList.add("dragging");
      document.body.classList.add("resizing");
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    });
  }
})();

// When language changes, re-render everything that was built dynamically.
window.addEventListener("langchange", () => {
  renderAuth();
  renderProjects(lastProjects);
  updateProviderBadge();
  statusEl.textContent = i18n.t(statusKey);
});

// init
(async function init() {
  await loadHealth();
  await loadMe();
  await loadProjects();
})();
