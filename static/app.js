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
const modelSelect = document.getElementById("model-select");
const authBox = document.getElementById("auth-box");
const projectsList = document.getElementById("projects-list");
const refreshBtn = document.getElementById("refresh-projects");
const langToggle = document.getElementById("lang-toggle");
const modeLabel = document.getElementById("mode-label");
const newAppBtn = document.getElementById("new-app");

let currentUser = null;
let lastProjects = [];       // cache so we can re-render on language change
let statusKey = "status.idle";
let availableModels = [];    // [{id,label,free,transport}] from /api/models
const MODEL_STORE_KEY = "atoms:selectedModel";

// Current app being worked on. When set, the composer iterates on it (edit mode)
// instead of creating a new app. project_id is set for logged-in saved apps;
// guests keep only the html so they can still iterate client-side.
let currentProjectId = null;
let currentHtml = null;
let currentTitle = "";       // first prompt / project name, shown in the edit banner

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

// --- create / iterate mode ----------------------------------------------
// Reflect whether we're building a new app or editing the current one. In edit
// mode the banner names the app, a "＋ new app" button appears, and the
// composer button/placeholder switch to the "update" wording.

function renderMode() {
  const editing = currentHtml != null;
  if (editing) {
    modeLabel.textContent = i18n.t("app.mode_edit", { name: currentTitle });
    sendBtn.textContent = i18n.t("app.iterate");
    promptEl.placeholder = i18n.t("app.prompt_ph_edit");
    newAppBtn.classList.remove("hidden");
  } else {
    modeLabel.textContent = i18n.t("app.mode_new");
    sendBtn.textContent = i18n.t("app.generate");
    promptEl.placeholder = i18n.t("app.prompt_ph");
    newAppBtn.classList.add("hidden");
  }
}

// Enter edit mode for a given app (after generate / open).
function enterEditMode({ projectId, html, title }) {
  currentProjectId = projectId ?? null;
  currentHtml = html;
  if (title) currentTitle = title;
  renderMode();
}

// Back to a clean slate to build a brand-new app.
function startNewApp() {
  currentProjectId = null;
  currentHtml = null;
  currentTitle = "";
  previewEl.classList.add("hidden");
  previewPlaceholder.classList.remove("hidden");
  setStatus("status.idle");
  renderMode();
  addMessage("assistant", i18n.t("msg.new_app"));
  promptEl.focus();
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
  // The saved project_id is no longer usable once logged out, but keep the
  // current html so the user can still iterate as a guest (client-side base).
  currentProjectId = null;
  renderAuth();
  renderProjects([]);
  renderMode();
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
  enterEditMode({ projectId: id, html: data.html, title: data.prompt });
  addMessage("assistant", i18n.t("msg.loaded", { id, prompt: data.prompt }));
}

// --- generate ------------------------------------------------------------

// --- model picker --------------------------------------------------------
// Trae-style dropdown. The server only exposes models whose API key is set
// (plus keyless mock); we send the chosen id with each generate request. The
// pick is remembered in localStorage across reloads.

function selectedModelId() {
  return modelSelect.value || null;
}

function renderModelOptions() {
  const remembered = localStorage.getItem(MODEL_STORE_KEY);
  modelSelect.innerHTML = "";
  for (const m of availableModels) {
    const opt = document.createElement("option");
    opt.value = m.id;
    // Flag free options so users can spot the no-cost picks at a glance.
    opt.textContent = m.free ? `${m.label} · ${i18n.t("app.model_free")}` : m.label;
    modelSelect.appendChild(opt);
  }
  // Restore the remembered pick if it's still available, else use the default.
  const ids = availableModels.map((m) => m.id);
  if (remembered && ids.includes(remembered)) {
    modelSelect.value = remembered;
  }
}

async function loadModels() {
  const { ok, data } = await api("/api/models");
  availableModels = ok ? (data.models || []) : [];
  renderModelOptions();
  // Fall back to server default if nothing valid is selected yet.
  if (!modelSelect.value && data && data.default) {
    const ids = availableModels.map((m) => m.id);
    if (ids.includes(data.default)) modelSelect.value = data.default;
  }
}

modelSelect.addEventListener("change", () => {
  localStorage.setItem(MODEL_STORE_KEY, modelSelect.value);
});

async function generate(prompt) {
  const editing = currentHtml != null;
  sendBtn.disabled = true;
  setStatus("status.generating");
  addMessage("assistant", i18n.t(editing ? "msg.editing" : "msg.generating"));
  try {
    const body = { prompt };
    const modelId = selectedModelId();
    if (modelId) body.model = modelId;
    if (editing) {
      // Logged-in saved app -> iterate by project_id (server holds the base).
      // Guest -> send the current html so it can still be edited client-side.
      if (currentProjectId != null) body.project_id = currentProjectId;
      else body.base_html = currentHtml;
    }
    const { ok, status, data } = await api("/api/generate", {
      method: "POST",
      body: JSON.stringify(body),
    });
    if (!ok) throw new Error(data.error || `HTTP ${status}`);
    showPreview(data.html);
    setStatus("status.ready");

    // Remember the produced app so the next message keeps iterating on it.
    if (!editing) currentTitle = prompt;
    enterEditMode({ projectId: data.project_id, html: data.html, title: currentTitle });

    const didEdit = editing || data.iterated;
    let saved = "";
    if (data.project_id) {
      saved = i18n.t(didEdit ? "msg.updated_suffix" : "msg.saved_suffix", { id: data.project_id });
    }
    addMessage("assistant", i18n.t(didEdit ? "msg.done_edit" : "msg.done", {
      provider: data.provider, saved,
    }));
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
newAppBtn.addEventListener("click", startNewApp);

// --- resizable panels ----------------------------------------------------
// Layout order: projects | resizer | chat(flex) | resizer | preview.
// The chat column is the flexible `1fr` filler that absorbs all resize deltas,
// so dragging can never dead-lock. The two SIDE columns (projects, preview) are
// px-sized and may be dragged all the way to 0 (fully hidden), then dragged back
// out again — like Trae/VS Code side panels.
//
// setPointerCapture keeps pointermove/pointerup on the divider even if the
// cursor moves fast or leaves it, so the final size always gets saved.

(function initResizers() {
  const layout = document.querySelector(".layout");
  if (!layout) return;

  const STORE_KEY = "atoms:panelWidths";
  // For each side divider: which CSS var it drives, and the sign that maps a
  // rightward drag (+dx) onto a width change. The projects column is on the
  // LEFT edge, so dragging its divider right GROWS it (sign +1); the preview
  // column is on the RIGHT edge, so dragging its divider right SHRINKS it (-1).
  const SIDE = {
    projects: { cssVar: "--projects-w", sign: +1 },
    preview:  { cssVar: "--preview-w",  sign: -1 },
  };
  const CHAT_MIN = 280;       // must match the grid's minmax() floor
  const COMPOSER_VAR = "--composer-h";
  const COMPOSER_MIN = 96;    // keep textarea + button usable
  const MESSAGES_MIN = 120;   // messages list must keep at least this above input

  function loadStore() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY) || "{}"); }
    catch { return {}; }
  }
  function saveStore(patch) {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({ ...loadStore(), ...patch }));
    } catch { /* quota / private mode */ }
  }

  // Restore saved sizes.
  const saved = loadStore();
  for (const [target, { cssVar }] of Object.entries(SIDE)) {
    if (typeof saved[target] === "number") {
      layout.style.setProperty(cssVar, `${saved[target]}px`);
    }
  }
  const composer = document.querySelector(".composer");
  if (composer && typeof saved.composer === "number") {
    composer.style.setProperty(COMPOSER_VAR, `${saved.composer}px`);
  }

  const px = (el, cssVar) =>
    parseInt(getComputedStyle(el).getPropertyValue(cssVar), 10) || 0;

  // --- side dividers (collapsible column widths) ------------------------
  for (const el of document.querySelectorAll(".resizer")) {
    const target = el.dataset.target;
    const cfg = SIDE[target];
    if (!cfg) continue;
    const { cssVar, sign } = cfg;

    el.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      try { el.setPointerCapture(e.pointerId); } catch { /* capture optional */ }
      const startX = e.clientX;
      const startW = px(layout, cssVar);
      // This column may grow until the flexible chat column hits CHAT_MIN.
      const chatW = document.querySelector(".chat-panel").clientWidth;
      const maxW = startW + Math.max(0, chatW - CHAT_MIN);

      el.classList.add("dragging");
      document.body.classList.add("resizing");

      const onMove = (ev) => {
        // Collapsible to 0, capped so the flexible middle keeps its minimum.
        const delta = sign * (ev.clientX - startX);
        const w = Math.max(0, Math.min(startW + delta, maxW));
        layout.style.setProperty(cssVar, `${w}px`);
      };
      const onUp = () => {
        el.classList.remove("dragging");
        document.body.classList.remove("resizing");
        el.removeEventListener("pointermove", onMove);
        el.removeEventListener("pointerup", onUp);
        saveStore({ [target]: px(layout, cssVar) });
      };
      el.addEventListener("pointermove", onMove);
      el.addEventListener("pointerup", onUp);
    });
  }

  // --- vertical divider (input area height) -----------------------------
  const hResizer = document.querySelector('.resizer-h[data-target="composer"]');
  if (hResizer && composer) {
    hResizer.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      try { hResizer.setPointerCapture(e.pointerId); } catch { /* capture optional */ }
      const startY = e.clientY;
      const startH = composer.clientHeight;
      const messagesH = document.getElementById("messages").clientHeight;
      const maxH = startH + Math.max(0, messagesH - MESSAGES_MIN);

      hResizer.classList.add("dragging");
      document.body.classList.add("resizing-v");

      const onMove = (ev) => {
        // Drag up => taller input, so subtract the downward delta.
        const h = Math.max(COMPOSER_MIN, Math.min(startH - (ev.clientY - startY), maxH));
        composer.style.setProperty(COMPOSER_VAR, `${h}px`);
      };
      const onUp = () => {
        hResizer.classList.remove("dragging");
        document.body.classList.remove("resizing-v");
        hResizer.removeEventListener("pointermove", onMove);
        hResizer.removeEventListener("pointerup", onUp);
        saveStore({ composer: composer.clientHeight });
      };
      hResizer.addEventListener("pointermove", onMove);
      hResizer.addEventListener("pointerup", onUp);
    });
  }
})();

// When language changes, re-render everything that was built dynamically.
window.addEventListener("langchange", () => {
  renderAuth();
  renderProjects(lastProjects);
  renderModelOptions();
  renderMode();
  statusEl.textContent = i18n.t(statusKey);
});

// init
(async function init() {
  renderMode();
  await loadModels();
  await loadMe();
  await loadProjects();
})();
