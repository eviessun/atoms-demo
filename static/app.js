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
// Version history dialog
const historyBtn = document.getElementById("history-btn");
const historyOverlay = document.getElementById("history-overlay");
const historyList = document.getElementById("history-list");
const historyX = document.getElementById("history-x");
// Preview panel: Preview/Code tabs + code view (Trae-style)
const previewTabs = document.getElementById("preview-tabs");
const tabPreview = document.getElementById("tab-preview");
const tabCode = document.getElementById("tab-code");
const codeView = document.getElementById("code-view");
const codeContent = document.getElementById("code-content");
const codeCopy = document.getElementById("code-copy");
const codeDownload = document.getElementById("code-download");
const codeOpen = document.getElementById("code-open");
const codeScroller = codeContent.parentElement;   // the scrollable <pre>
// File strip above the composer
const fileStrip = document.getElementById("file-strip");
const fileChip = document.getElementById("file-chip");
// BYOK dialog elements
const byokGear = document.getElementById("byok-gear");
const byokOverlay = document.getElementById("byok-overlay");
const byokForm = document.getElementById("byok-form");
const byokProvider = document.getElementById("byok-provider");
const byokTransport = document.getElementById("byok-transport");
const byokBaseUrl = document.getElementById("byok-base-url");
const byokModel = document.getElementById("byok-model");
const byokKey = document.getElementById("byok-key");
const byokDocs = document.getElementById("byok-docs");
const byokCancel = document.getElementById("byok-cancel");
const byokX = document.getElementById("byok-x");
const byokClear = document.getElementById("byok-clear");

let currentUser = null;
let lastProjects = [];       // cache so we can re-render on language change
let statusKey = "status.idle";
let availableModels = [];    // [{id,label,free,transport,byok}] from /api/models
const MODEL_STORE_KEY = "atoms:selectedModel";
const BYOK_STORE_KEY = "atoms:byok";   // {key,model,base_url,transport,provider}

// Current app being worked on. When set, the composer iterates on it (edit mode)
// instead of creating a new app. project_id is set for logged-in saved apps;
// guests keep only the html so they can still iterate client-side.
let currentProjectId = null;
let currentHtml = null;
let currentTitle = "";       // first prompt / project name, shown in the edit banner

// Guards against overlapping generations. A second submit while one is still
// running would race: the first hasn't returned its project_id yet, so the
// second also runs as "create" and forks a duplicate project. This flag is set
// synchronously on submit (before any await), so re-entrant submits are dropped.
let generating = false;

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

// --- preview panel: Preview / Code tabs ---------------------------------
// The right panel shows either the running app (iframe) or its source. During
// generation we auto-switch to Code so the user watches it being written, then
// flip back to Preview once it's done. The tab buttons let them toggle freely.

let activeTab = "preview";   // "preview" | "code"

function switchTab(tab) {
  activeTab = tab;
  tabPreview.classList.toggle("active", tab === "preview");
  tabCode.classList.toggle("active", tab === "code");
  // Preview view = placeholder-or-iframe; Code view = source pre.
  const showCode = tab === "code";
  codeView.classList.toggle("hidden", !showCode);
  // In preview mode, show whichever of placeholder/iframe is appropriate.
  previewPlaceholder.classList.toggle("hidden", showCode || currentHtml != null);
  previewEl.classList.toggle("hidden", showCode || currentHtml == null);
}

// Put source into the Code tab. Used both live (streaming) and on completion.
function setCode(source) {
  codeContent.textContent = source;
}

// Swap the dark placeholder for the (white) iframe once we have content to show.
function showPreview(html) {
  previewEl.srcdoc = html;
  setCode(html);
  switchTab("preview");
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
  // The file strip only makes sense once there's an app (a file) to show.
  fileStrip.classList.toggle("hidden", !editing);
  // Version history exists only for saved projects (persisted server-side).
  historyBtn.classList.toggle("hidden", !(editing && currentProjectId != null));
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
  setCode("");
  switchTab("preview");   // reset to the placeholder
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
  enterEditMode({ projectId: id, html: data.html, title: data.prompt });
  showPreview(data.html);
  setStatus("status.ready");
  addMessage("assistant", i18n.t("msg.loaded", { id, prompt: data.prompt }));
}

// --- version history + rollback -----------------------------------------
// Every generate/iterate/restore appends a snapshot server-side. This dialog
// lists them newest-first; "Preview" loads an old snapshot into the iframe
// without committing, and "Roll back" restores it (itself recorded as a new
// version, so history is never truncated).

function closeHistoryDialog() { historyOverlay.classList.add("hidden"); }

async function openHistoryDialog() {
  if (currentProjectId == null) return;
  historyList.innerHTML = "";
  historyOverlay.classList.remove("hidden");
  const { ok, data } = await api(`/api/projects/${currentProjectId}/versions`);
  const versions = ok ? (data.versions || []) : [];
  renderHistory(versions);
}

function renderHistory(versions) {
  historyList.innerHTML = "";
  if (!versions.length) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = i18n.t("app.history_none");
    historyList.appendChild(li);
    return;
  }
  versions.forEach((v, i) => {
    const li = document.createElement("li");
    li.className = "history-item";

    const info = document.createElement("div");
    info.className = "history-info";
    const title = document.createElement("div");
    title.className = "history-title";
    // Newest row is the project's current state — flag it.
    const badge = i === 0 ? ` · ${i18n.t("app.history_current")}` : "";
    title.textContent = v.prompt;
    const meta = document.createElement("div");
    meta.className = "history-meta";
    meta.textContent = `v${v.id} · ${v.provider} · ${v.created_at}${badge}`;
    info.append(title, meta);

    const actions = document.createElement("div");
    actions.className = "history-actions";
    const preview = document.createElement("button");
    preview.className = "ghost small";
    preview.textContent = i18n.t("app.version_preview");
    preview.onclick = () => previewVersion(v.id);
    actions.appendChild(preview);
    // No point offering "roll back" to the state we're already on.
    if (i !== 0) {
      const restore = document.createElement("button");
      restore.className = "small";
      restore.textContent = i18n.t("app.version_restore");
      restore.onclick = () => restoreVersion(v.id);
      actions.appendChild(restore);
    }

    li.append(info, actions);
    historyList.appendChild(li);
  });
}

// Load an old snapshot into the preview WITHOUT changing the saved project.
async function previewVersion(versionId) {
  const { ok, data } = await api(`/api/projects/${currentProjectId}/versions/${versionId}`);
  if (!ok) return;
  showPreview(data.html);
  setStatus("status.ready");
  closeHistoryDialog();
  addMessage("assistant", i18n.t("msg.version_previewing", { id: versionId }));
}

// Restore an old snapshot as the current project state (non-destructive).
async function restoreVersion(versionId) {
  const { ok, data } = await api(
    `/api/projects/${currentProjectId}/versions/${versionId}/restore`,
    { method: "POST" }
  );
  if (!ok) {
    addMessage("assistant", i18n.t("msg.version_restore_fail", { msg: data.error || "" }));
    return;
  }
  showPreview(data.html);
  setStatus("status.ready");
  enterEditMode({ projectId: data.id, html: data.html, title: data.prompt });
  closeHistoryDialog();
  addMessage("assistant", i18n.t("msg.version_restored", { id: versionId }));
  loadProjects();
}

historyBtn.addEventListener("click", openHistoryDialog);
historyX.addEventListener("click", closeHistoryDialog);
historyOverlay.addEventListener("click", (e) => {
  if (e.target === historyOverlay) closeHistoryDialog();
});

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
  maybePromptByok();
});

// --- BYOK (bring your own key) ------------------------------------------
// The user's key/model/base_url live ONLY in localStorage on this device and
// are sent with each generate request for one-time use. The server never
// stores them. Presets (base URL + default model + docs link) come from
// /api/byok/presets and contain no secrets.

let byokPresets = [];

function loadByok() {
  try { return JSON.parse(localStorage.getItem(BYOK_STORE_KEY) || "null"); }
  catch { return null; }
}
function saveByok(cfg) { localStorage.setItem(BYOK_STORE_KEY, JSON.stringify(cfg)); }
function clearByok() { localStorage.removeItem(BYOK_STORE_KEY); }
function hasByok() {
  const c = loadByok();
  return !!(c && c.key && c.model);
}

async function loadByokPresets() {
  const { ok, data } = await api("/api/byok/presets");
  byokPresets = ok ? (data.presets || []) : [];
  byokProvider.innerHTML = "";
  for (const p of byokPresets) {
    const opt = document.createElement("option");
    opt.value = p.id;
    opt.textContent = p.label;
    byokProvider.appendChild(opt);
  }
}

// Applying a preset fills base URL / model / transport / docs so the user only
// pastes a key. "custom" leaves the editable fields as-is.
function applyPreset(id) {
  const p = byokPresets.find((x) => x.id === id);
  if (!p) return;
  if (p.id !== "custom") {
    byokBaseUrl.value = p.base_url || "";
    byokModel.value = p.model || "";
    byokTransport.value = p.transport || "openai";
  }
  if (p.key_hint) byokKey.placeholder = p.key_hint;
  if (p.docs) {
    byokDocs.href = p.docs;
    byokDocs.classList.remove("hidden");
  } else {
    byokDocs.classList.add("hidden");
  }
}

function openByokDialog() {
  const cfg = loadByok();
  if (byokPresets.length && !byokProvider.value) byokProvider.value = byokPresets[0].id;
  // Prefill from a previously saved config, else from the current preset.
  if (cfg) {
    byokProvider.value = cfg.provider || byokProvider.value;
    applyPreset(byokProvider.value);
    byokBaseUrl.value = cfg.base_url || byokBaseUrl.value;
    byokModel.value = cfg.model || byokModel.value;
    byokTransport.value = cfg.transport || byokTransport.value;
    byokKey.value = cfg.key || "";
  } else {
    applyPreset(byokProvider.value);
    byokKey.value = "";
  }
  byokOverlay.classList.remove("hidden");
  byokKey.focus();
}

function closeByokDialog() { byokOverlay.classList.add("hidden"); }

// If the user picks the BYOK model but hasn't configured a key, open the dialog.
function maybePromptByok() {
  const m = availableModels.find((x) => x.id === modelSelect.value);
  if (m && m.byok && !hasByok()) openByokDialog();
}

byokGear.addEventListener("click", openByokDialog);
byokCancel.addEventListener("click", closeByokDialog);
byokX.addEventListener("click", closeByokDialog);
byokOverlay.addEventListener("click", (e) => {
  if (e.target === byokOverlay) closeByokDialog();
});
byokProvider.addEventListener("change", () => applyPreset(byokProvider.value));
byokClear.addEventListener("click", () => {
  clearByok();
  byokKey.value = "";
  closeByokDialog();
  addMessage("assistant", i18n.t("byok.cleared"));
});
byokForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const key = byokKey.value.trim();
  const model = byokModel.value.trim();
  const transport = byokTransport.value;
  const base_url = byokBaseUrl.value.trim();
  if (!key) { byokKey.focus(); addMessage("assistant", i18n.t("byok.err.key")); return; }
  if (!model) { byokModel.focus(); addMessage("assistant", i18n.t("byok.err.model")); return; }
  if (transport === "openai" && !base_url) {
    byokBaseUrl.focus(); addMessage("assistant", i18n.t("byok.err.base_url")); return;
  }
  saveByok({ key, model, base_url, transport, provider: byokProvider.value });
  closeByokDialog();
  addMessage("assistant", i18n.t("byok.saved"));
});

// Build the request body shared by the blocking and streaming paths. Returns
// the body object, or null when the BYOK model is selected but not configured
// (in which case it surfaces the dialog + a message and the caller must abort).
function composeBody(prompt, editing) {
  const body = { prompt };
  const modelId = selectedModelId();
  if (modelId) body.model = modelId;
  // BYOK: attach the user's own credentials (stored locally) for this request.
  if (modelId === "byok") {
    const cfg = loadByok();
    if (!cfg || !cfg.key || !cfg.model) {
      setStatus("status.error");
      addMessage("assistant", i18n.t("byok.not_configured"));
      openByokDialog();
      return null;
    }
    body.byok_key = cfg.key;
    body.byok_model = cfg.model;
    body.byok_base_url = cfg.base_url || "";
    body.byok_transport = cfg.transport || "openai";
  }
  if (editing) {
    // Logged-in saved app -> iterate by project_id (server holds the base).
    // Guest -> send the current html so it can still be edited client-side.
    if (currentProjectId != null) body.project_id = currentProjectId;
    else body.base_html = currentHtml;
  }
  return body;
}

// Once a generation finishes, mirror it into the UI + local state the same way
// for both the blocking and streaming paths: render the preview, enter edit
// mode, report where it was saved, and refresh the project list.
function afterGenerate({ prompt, editing, html, provider, projectId, iterated }) {
  if (!editing) currentTitle = prompt;
  // Set state (currentHtml) first so showPreview picks the iframe, not the
  // placeholder, when it flips back to the Preview tab.
  enterEditMode({ projectId, html, title: currentTitle });
  showPreview(html);
  setStatus("status.ready");

  const didEdit = editing || iterated;
  let saved = "";
  if (projectId) {
    saved = i18n.t(didEdit ? "msg.updated_suffix" : "msg.saved_suffix", { id: projectId });
  }
  addMessage("assistant", i18n.t(didEdit ? "msg.done_edit" : "msg.done", { provider, saved }));
  if (projectId) loadProjects();
}

// Blocking generation — kept as a fallback for when the streaming endpoint is
// unreachable (older deploy, proxy that buffers SSE, fetch/stream unsupported).
async function generate(prompt) {
  const editing = currentHtml != null;
  const body = composeBody(prompt, editing);
  if (!body) return;   // BYOK not configured; composeBody handled the UI
  sendBtn.disabled = true;
  setStatus("status.generating");
  addMessage("assistant", i18n.t(editing ? "msg.editing" : "msg.generating"));
  try {
    const { ok, status, data } = await api("/api/generate", {
      method: "POST",
      body: JSON.stringify(body),
    });
    if (!ok) throw new Error(data.error || `HTTP ${status}`);
    afterGenerate({
      prompt, editing, html: data.html, provider: data.provider,
      projectId: data.project_id, iterated: data.iterated,
    });
  } catch (err) {
    setStatus("status.error");
    addMessage("assistant", i18n.t("msg.error", { msg: err.message }));
  } finally {
    sendBtn.disabled = false;
  }
}

// A live assistant message that grows as SSE events arrive. It shows the
// model's status and a collapsible "reasoning" block (chain-of-thought). The
// generated CODE no longer dumps into the chat — it streams into the preview
// panel's Code tab instead (Trae-style), keeping the conversation readable.
function addStreamingMessage() {
  const div = document.createElement("div");
  div.className = "msg assistant streaming";

  const status = document.createElement("p");
  status.className = "stream-status";
  status.textContent = i18n.t("status.streaming");
  div.appendChild(status);

  const details = document.createElement("details");
  details.className = "reasoning hidden";
  details.open = true;
  const summary = document.createElement("summary");
  summary.textContent = i18n.t("app.reasoning");
  const reasoningBody = document.createElement("div");
  reasoningBody.className = "reasoning-body";
  details.append(summary, reasoningBody);
  div.appendChild(details);

  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;

  const nearBottom = () =>
    messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < 80;
  const stick = (fn) => { const s = nearBottom(); fn(); if (s) messagesEl.scrollTop = messagesEl.scrollHeight; };

  // The code streams into the right-hand Code view. Accumulate locally and
  // auto-scroll that pane so the newest lines stay visible.
  let codeBuf = "";
  let codeStarted = false;

  return {
    setModel(label) {
      status.textContent = i18n.t("status.streaming_model", { model: label });
    },
    reasoning(delta) {
      stick(() => { details.classList.remove("hidden"); reasoningBody.textContent += delta; });
    },
    content(delta) {
      // First code token: flip the panel to the Code tab so the user watches
      // it being written, and label the composer/chat status accordingly.
      if (!codeStarted) {
        codeStarted = true;
        status.textContent = i18n.t("app.generating_code");
        switchTab("code");
      }
      codeBuf += delta;
      setCode(codeBuf);
      // keep the code pane pinned to the newest lines
      codeScroller.scrollTop = codeScroller.scrollHeight;
    },
    done() {
      div.classList.remove("streaming");
      details.open = false;   // collapse the thinking to keep the log tidy
      status.remove();
    },
    remove() { div.remove(); },
  };
}

// Streaming generation (primary path). Consumes the SSE stream from
// /api/generate/stream, showing reasoning + code as they're produced. Falls
// back to the blocking generate() if the stream endpoint is unreachable.
async function generateStream(prompt) {
  const editing = currentHtml != null;
  const body = composeBody(prompt, editing);
  if (!body) return;   // BYOK not configured; composeBody handled the UI

  sendBtn.disabled = true;
  setStatus("status.generating");
  const stream = addStreamingMessage();

  let res;
  try {
    res = await fetch("/api/generate/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    stream.remove();          // couldn't reach the stream endpoint
    return generate(prompt);  // degrade to the blocking path
  }

  if (res.status === 404) {   // endpoint missing (older deploy) -> fallback
    stream.remove();
    sendBtn.disabled = false;
    return generate(prompt);
  }
  if (!res.ok || !res.body) {
    stream.remove();
    let data = {};
    try { data = await res.json(); } catch { /* no body */ }
    setStatus("status.error");
    addMessage("assistant", i18n.t("msg.error", { msg: data.error || `HTTP ${res.status}` }));
    sendBtn.disabled = false;
    return;
  }

  let finalHtml = null, provider = "", projectId = null, iterated = false, errored = false;
  const dispatch = (evt) => {
    switch (evt.type) {
      case "model": provider = evt.label; stream.setModel(evt.label); break;
      case "reasoning": stream.reasoning(evt.delta); break;
      case "content": stream.content(evt.delta); break;
      case "error":
        errored = true;
        setStatus("status.error");
        addMessage("assistant", i18n.t("msg.error", { msg: evt.message }));
        break;
      case "done":
        finalHtml = evt.html;
        provider = evt.provider || provider;
        projectId = evt.project_id;
        iterated = evt.iterated;
        break;
    }
  };

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf("\n\n")) !== -1) {
        const frame = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        const line = frame.split("\n").find((l) => l.startsWith("data:"));
        if (!line) continue;
        try { dispatch(JSON.parse(line.slice(5).trim())); }
        catch { /* ignore a malformed frame */ }
      }
    }
  } catch (err) {
    errored = true;
    setStatus("status.error");
    addMessage("assistant", i18n.t("msg.error", { msg: err.message }));
  }

  stream.done();
  if (errored || finalHtml == null) { sendBtn.disabled = false; return; }
  afterGenerate({ prompt, editing, html: finalHtml, provider, projectId, iterated });
  sendBtn.disabled = false;
}

composer.addEventListener("submit", async (e) => {
  e.preventDefault();
  // Ignore re-entrant submits while a generation is in flight. Set the flag
  // synchronously here (before any await) so a fast second click can't race the
  // first into creating a duplicate project. It's cleared in finally once the
  // whole run settles — including the streaming path's fallback to generate().
  if (generating) return;
  const prompt = promptEl.value.trim();
  if (!prompt) return;
  generating = true;
  addMessage("user", prompt);
  promptEl.value = "";
  try {
    await generateStream(prompt);
  } finally {
    generating = false;
  }
});

refreshBtn.addEventListener("click", loadProjects);
langToggle.addEventListener("click", () => i18n.toggle());
newAppBtn.addEventListener("click", startNewApp);

// Preview/Code tabs, file chip, and copy button.
tabPreview.addEventListener("click", () => switchTab("preview"));
tabCode.addEventListener("click", () => switchTab("code"));
// Clicking the file opens its source in the Code tab (single-file app).
fileChip.addEventListener("click", () => switchTab("code"));
codeCopy.addEventListener("click", async () => {
  if (!currentHtml) return;
  try {
    await navigator.clipboard.writeText(currentHtml);
    const prev = codeCopy.textContent;
    codeCopy.textContent = "✓";
    setTimeout(() => { codeCopy.textContent = prev; }, 1200);
  } catch { /* clipboard blocked; no-op */ }
});

// --- export the generated app -------------------------------------------
// The app is a single self-contained index.html, so "export" is just handing
// the current HTML to the user: download it as a file, or open it in a new tab
// to run it standalone (outside our sandboxed preview iframe).

// Turn the project title into a safe-ish file slug, defaulting to "app".
function appFilename() {
  const base = (currentTitle || "app")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")   // non-alnum -> dashes
    .replace(/^-+|-+$/g, "")       // trim leading/trailing dashes
    .slice(0, 40);
  return `${base || "app"}.html`;
}

codeDownload.addEventListener("click", () => {
  if (!currentHtml) return;
  const blob = new Blob([currentHtml], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = appFilename();
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  addMessage("assistant", i18n.t("msg.downloaded"));
});

codeOpen.addEventListener("click", () => {
  if (!currentHtml) return;
  // Blob URL (not srcdoc) so the new tab runs the app at its own origin.
  const blob = new Blob([currentHtml], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  window.open(url, "_blank", "noopener");
  // Give the new tab time to load before releasing the object URL.
  setTimeout(() => URL.revokeObjectURL(url), 10000);
});

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
  await loadByokPresets();
  await loadMe();
  await loadProjects();
})();
