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
// Featured showcase (public gallery guests can preview)
const featuredBox = document.getElementById("featured");
const featuredList = document.getElementById("featured-list");
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
const codeFileTabs = document.getElementById("code-file-tabs");
const codeCopy = document.getElementById("code-copy");
const codeDownload = document.getElementById("code-download");
const codeOpen = document.getElementById("code-open");
const codeScroller = codeContent.parentElement;   // the scrollable <pre>
// File strip above the composer
const fileStrip = document.getElementById("file-strip");
const fileChips = document.getElementById("file-chips");
// Composer multimodal tools: image attach + voice input
const attachStrip = document.getElementById("attach-strip");
const attachBtn = document.getElementById("attach-btn");
const imageInput = document.getElementById("image-input");
const micBtn = document.getElementById("mic-btn");
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
// Becomes true once /api/auth/me resolves. Guards the "guests must log in to
// compose" redirect so we never bounce a real logged-in user during the brief
// window before their session is confirmed on page load.
let authReady = false;
let lastProjects = [];       // cache so we can re-render on language change
let lastFeatured = [];       // cache of the public showcase gallery (re-render on lang change)
// While a brand-new app is being generated, this holds its prompt so the
// projects list can show an optimistic "generating…" placeholder at the top
// (the real row only appears after the model finishes + it's persisted). null
// when nothing is pending. See renderProjects() and the composer submit handler.
let pendingProjectTitle = null;
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

// Multi-file mode: set when a featured showcase is opened (its sources are
// distributed across index.html + style.css + app.js). null for regular
// projects and freshly generated apps, which stay single-file. When set:
//   - the Code tab shows a file switcher (tabs) and the file strip lists chips
//   - the preview iframe uses `src` (served from /featured-files/) so relative
//     <link> / <script src> refs resolve; single-file mode still uses `srcdoc`
//   - iterate/edit is disabled (featured apps are read-only demos)
// `files` is [{name, language, content}]; the entry (index.html) is at [0].
let currentFiles = null;
let currentFilesSlug = null;   // slug for /featured-files/<slug>/... iframe src
let currentActiveFile = null;  // name of the file currently shown in the Code tab

// Guards against overlapping generations. A second submit while one is still
// running would race: the first hasn't returned its project_id yet, so the
// second also runs as "create" and forks a duplicate project. This flag is set
// synchronously on submit (before any await), so re-entrant submits are dropped.
let generating = false;

// Idempotency key for the in-flight CREATE. Minted once per create submit and
// sent to the server, which ties all copies of that one request to a single
// project (see db.create_project). Belt-and-suspenders with `generating`: the
// flag stops double-submits in this tab; the key stops transport-level dupes
// (dropped response + replay, proxy retry) from forking a second project.
let createIdemKey = null;

function newIdemKey() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return `idem-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

// Staged image attachments (base64 data URLs) for the next generate request.
// Sent only when the selected model is vision-capable; cleared after each send.
let attachedImages = [];
// Images locked in for the in-flight request. Set at submit (snapshot of
// attachedImages) so composeBody sends them even though the staging strip is
// cleared immediately; survives a stream->blocking fallback. Cleared in finally.
let pendingImages = [];
const MAX_IMAGES = 4;              // mirror the server cap (main.MAX_IMAGES)
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;   // ~5MB source; server caps the base64

function addMessage(role, text, images) {
  const div = document.createElement("div");
  div.className = `msg ${role}`;
  const p = document.createElement("p");
  p.textContent = text;
  div.appendChild(p);
  // Echo any attached images as small thumbnails under the user's message.
  if (images && images.length) {
    const strip = document.createElement("div");
    strip.className = "msg-images";
    for (const src of images) {
      const img = document.createElement("img");
      img.src = src;
      img.alt = "";
      strip.appendChild(img);
    }
    div.appendChild(strip);
  }
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

// True while any app is loaded (single-file OR multi-file). Both modes flow
// through this predicate so the preview/code visibility logic doesn't need to
// care which mode we're in.
function hasApp() { return currentHtml != null || currentFiles != null; }

function switchTab(tab) {
  activeTab = tab;
  tabPreview.classList.toggle("active", tab === "preview");
  tabCode.classList.toggle("active", tab === "code");
  // Preview view = placeholder-or-iframe; Code view = source pre.
  const showCode = tab === "code";
  codeView.classList.toggle("hidden", !showCode);
  // In preview mode, show whichever of placeholder/iframe is appropriate.
  const loaded = hasApp();
  previewPlaceholder.classList.toggle("hidden", showCode || loaded);
  previewEl.classList.toggle("hidden", showCode || !loaded);
}

// Put source into the Code tab. Used both live (streaming, single-file) and on
// completion; for multi-file mode selectCodeFile() drives it instead.
function setCode(source) {
  codeContent.textContent = source;
}

// Rebuild the code-view file tab strip and the composer file-chip strip from
// the current mode. Single-file mode shows one tab/chip named "index.html";
// multi-file mode lists every file, with the active one highlighted.
function renderFileTabs() {
  const files = currentFiles
    ? currentFiles.map((f) => f.name)
    : (currentHtml != null ? ["index.html"] : []);
  const active = currentActiveFile || files[0] || "index.html";

  codeFileTabs.innerHTML = "";
  fileChips.innerHTML = "";
  for (const name of files) {
    const tab = document.createElement("button");
    tab.type = "button";
    tab.className = "code-file-tab" + (name === active ? " active" : "");
    tab.dataset.file = name;
    tab.textContent = name;
    tab.onclick = () => selectCodeFile(name);
    codeFileTabs.appendChild(tab);

    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "file-chip" + (name === active ? " active" : "");
    chip.dataset.file = name;
    const icon = document.createElement("span");
    icon.className = "file-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = "📄";
    const label = document.createElement("span");
    label.className = "file-name";
    label.textContent = name;
    chip.append(icon, label);
    chip.onclick = () => {
      selectCodeFile(name);
      switchTab("code");
    };
    fileChips.appendChild(chip);
  }
}

// Switch which file's source the Code tab is showing. In multi-file mode this
// swaps codeContent from the file's cached content; in single-file mode it's
// a no-op (there's only one file).
function selectCodeFile(name) {
  currentActiveFile = name;
  if (currentFiles) {
    const f = currentFiles.find((x) => x.name === name);
    setCode(f ? f.content : "");
  } else if (currentHtml != null) {
    setCode(currentHtml);
  }
  // Refresh active-state highlighting without rebuilding the DOM.
  for (const t of codeFileTabs.querySelectorAll(".code-file-tab")) {
    t.classList.toggle("active", t.dataset.file === name);
  }
  for (const c of fileChips.querySelectorAll(".file-chip")) {
    c.classList.toggle("active", c.dataset.file === name);
  }
}

// Swap the dark placeholder for the (white) iframe once we have content to show.
// Single-file mode (regular project / freshly generated app) — inline HTML
// via srcdoc so we don't need a server-side URL.
function showPreview(html) {
  currentActiveFile = "index.html";
  setCode(html);
  renderFileTabs();
  previewEl.removeAttribute("src");
  previewEl.srcdoc = html;
  // Reveal (hidden -> visible) on the NEXT frame, not this one. During
  // streaming we're on the Code tab, so the iframe is display:none when srcdoc
  // is assigned above. Assigning srcdoc and un-hiding in the SAME task leaves
  // some engines (Chromium) rendering the iframe blank/stale after an iterate.
  // Deferring the reveal to a separate frame performs a clean display
  // transition — exactly what a manual Code->Preview tab click does, which we
  // confirmed always repaints — so the new document actually shows.
  requestAnimationFrame(() => switchTab("preview"));
}

// Multi-file mode (featured showcase) — the iframe loads the entry HTML from
// a real URL so its relative <link> / <script src> refs resolve against the
// backend static endpoint. The Code tab is populated from the in-memory files
// list, so it stays in sync with what the iframe fetched.
function showPreviewMultiFile({ slug, entry }) {
  currentFilesSlug = slug;
  currentActiveFile = entry;
  const first = currentFiles.find((f) => f.name === entry) || currentFiles[0];
  setCode(first ? first.content : "");
  renderFileTabs();
  previewEl.srcdoc = "";
  previewEl.src = `/featured-files/${encodeURIComponent(slug)}/${encodeURIComponent(entry)}`;
  requestAnimationFrame(() => switchTab("preview"));
}

// --- create / iterate mode ----------------------------------------------
// Reflect whether we're building a new app or editing the current one. In edit
// mode the banner names the app, a "＋ new app" button appears, and the
// composer button/placeholder switch to the "update" wording.

function renderMode() {
  const loaded = hasApp();
  // Featured showcases are read-only demos, not editable projects — the composer
  // stays in "new app" mode so a submit starts a brand-new project (guests still
  // hit the login gate on the first keystroke).
  const editing = loaded && currentFiles == null;
  if (editing) {
    modeLabel.textContent = i18n.t("app.mode_edit", { name: currentTitle });
    sendBtn.textContent = i18n.t("app.iterate");
    promptEl.placeholder = i18n.t("app.prompt_ph_edit");
    newAppBtn.classList.remove("hidden");
  } else if (currentFiles != null) {
    // Featured mode: banner labels the showcase; "new app" button clears it.
    modeLabel.textContent = i18n.t("app.mode_featured", { name: currentTitle });
    sendBtn.textContent = i18n.t("app.generate");
    promptEl.placeholder = i18n.t("app.prompt_ph");
    newAppBtn.classList.remove("hidden");
  } else {
    modeLabel.textContent = i18n.t("app.mode_new");
    sendBtn.textContent = i18n.t("app.generate");
    promptEl.placeholder = i18n.t("app.prompt_ph");
    newAppBtn.classList.add("hidden");
  }
  // The file strip only makes sense once there's an app (file(s)) to show.
  fileStrip.classList.toggle("hidden", !loaded);
  // Version history exists only for saved projects (persisted server-side).
  historyBtn.classList.toggle("hidden", !(editing && currentProjectId != null));
}

// Enter edit mode for a given app (after generate / open).
function enterEditMode({ projectId, html, title }) {
  currentProjectId = projectId ?? null;
  currentHtml = html;
  // Leaving multi-file mode: clear those flags so single-file rendering wins.
  currentFiles = null;
  currentFilesSlug = null;
  if (title) currentTitle = title;
  renderMode();
}

// Enter read-only "featured" mode for a showcase app. Distinct from
// enterEditMode because these aren't user-owned and shouldn't be iterated on.
function enterFeaturedMode({ slug, files, entry, title }) {
  currentProjectId = null;
  currentHtml = null;
  currentFiles = files;
  currentFilesSlug = slug;
  currentActiveFile = entry;
  if (title) currentTitle = title;
  renderMode();
}

// Back to a clean slate to build a brand-new app.
function startNewApp() {
  currentProjectId = null;
  currentHtml = null;
  currentFiles = null;
  currentFilesSlug = null;
  currentActiveFile = null;
  currentTitle = "";
  setCode("");
  renderFileTabs();
  previewEl.removeAttribute("src");
  previewEl.srcdoc = "";
  switchTab("preview");   // reset to the placeholder
  setStatus("status.idle");
  // Clear the conversation so the new app starts fresh — otherwise the previous
  // project's chat (its "loaded"/"done" messages) lingers above the new one.
  messagesEl.innerHTML = "";
  // Drop any images staged for the old app; a brand-new app shouldn't inherit them.
  attachedImages = [];
  renderAttachments();
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
  authReady = true;
  renderAuth();
}

// Composing is a logged-in action. If a guest tries to type into / attach to /
// submit the composer, stash their draft and send them to the login page; the
// draft is restored when they come back logged in (see restoreDraft in init).
// Returns true when it redirects, so callers can bail out of their own work.
// `pendingText` is the not-yet-committed input (e.g. a beforeinput char or the
// pasted text) — folded into the draft since it hasn't landed in the value yet.
const DRAFT_KEY = "atoms:draft";
function requireLogin(pendingText) {
  // Don't act until /api/auth/me has resolved — otherwise we could bounce a
  // real logged-in user during the brief confirmation window on page load.
  if (!authReady || currentUser) return false;
  try { sessionStorage.setItem(DRAFT_KEY, promptEl.value + (pendingText || "")); }
  catch { /* private mode / storage full: skip persisting the draft */ }
  window.location.href = "/login";
  return true;
}

// On return from a successful login, put the guest's stashed draft back into
// the composer so they don't have to retype it. Cleared either way (a stale
// draft from a guest who never logged in shouldn't linger).
function restoreDraft() {
  let draft = null;
  try {
    draft = sessionStorage.getItem(DRAFT_KEY);
    sessionStorage.removeItem(DRAFT_KEY);
  } catch { /* storage unavailable: nothing to restore */ }
  if (draft && currentUser && !promptEl.value) {
    promptEl.value = draft;
    promptEl.focus();
  }
}

// --- projects ------------------------------------------------------------

// Render a server timestamp as Beijing time (UTC+8): "YYYY-MM-DD HH:MM:SS".
// The backend sends either an ISO string with an offset (Postgres, e.g.
// "2026-07-30T03:23:15.096132+00:00") or a space-separated UTC string with no
// offset (SQLite datetime('now')). Normalize the offset-less form to explicit
// UTC, then shift +8h and read the UTC fields so the output is deterministic
// regardless of the viewer's own locale/timezone.
function formatBeijingTime(ts) {
  if (!ts) return "";
  let s = String(ts);
  if (!/([zZ]|[+-]\d{2}:?\d{2})$/.test(s)) s = s.replace(" ", "T") + "Z";
  const d = new Date(s);
  if (isNaN(d.getTime())) return String(ts);  // unparseable: show raw
  const bj = new Date(d.getTime() + 8 * 3600 * 1000);
  const p = (n) => String(n).padStart(2, "0");
  return `${bj.getUTCFullYear()}-${p(bj.getUTCMonth() + 1)}-${p(bj.getUTCDate())} ` +
         `${p(bj.getUTCHours())}:${p(bj.getUTCMinutes())}:${p(bj.getUTCSeconds())}`;
}

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
  // Optimistic placeholder: a new app is only persisted once the model finishes,
  // so the list would otherwise sit unchanged for the whole generation. Show a
  // non-clickable "generating…" row at the top so the user gets instant feedback
  // that their new app is on the way. Cleared once loadProjects() refreshes with
  // the real row (or on failure). Re-rendered here so it survives a language
  // switch or a manual refresh while generation is still in flight.
  if (pendingProjectTitle != null) {
    const li = document.createElement("li");
    li.className = "item pending";
    const title = document.createElement("div");
    title.className = "title";
    title.textContent = pendingProjectTitle || i18n.t("app.project_pending");
    const meta = document.createElement("div");
    meta.className = "meta";
    meta.textContent = `⏳ ${i18n.t("app.project_pending_meta")}`;
    li.append(title, meta);
    projectsList.appendChild(li);
  }
  if (!lastProjects.length) {
    // With a pending placeholder already shown, an extra "no apps yet" row would
    // contradict it — only show the empty hint when there's nothing at all.
    if (pendingProjectTitle == null) {
      const li = document.createElement("li");
      li.className = "empty";
      li.textContent = i18n.t("app.projects_empty_none");
      projectsList.appendChild(li);
    }
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
    meta.textContent = `#${p.id} · ${p.provider} · ${formatBeijingTime(p.created_at)}`;
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

// --- featured showcase (public) -----------------------------------------
// A curated gallery served read-only from /api/featured. Anyone — including
// guests — can browse and preview these, so it's the "see what this builds"
// front door. Opening one loads it into the preview like a project but WITHOUT
// a project_id, so a logged-in user can remix it (creating their own new app)
// and a guest still hits the login gate on submit.

// Pick the title/description for the current UI language (both variants ship
// in the payload so switching languages needs no round trip).
function featuredText(item) {
  const en = i18n.getLang() === "en";
  return {
    title: (en ? item.title_en : item.title) || item.title || item.slug,
    description: (en ? item.description_en : item.description) || item.description || "",
  };
}

function renderFeatured(items) {
  lastFeatured = items || [];
  featuredList.innerHTML = "";
  // Nothing to show (no manifest / empty gallery): hide the whole block so the
  // panel doesn't carry a dangling header.
  if (!lastFeatured.length) {
    featuredBox.classList.add("hidden");
    return;
  }
  featuredBox.classList.remove("hidden");
  for (const item of lastFeatured) {
    const { title, description } = featuredText(item);
    const li = document.createElement("li");
    li.className = "featured-item";
    li.setAttribute("role", "button");
    li.tabIndex = 0;
    const h = document.createElement("div");
    h.className = "featured-title";
    h.textContent = title;
    const p = document.createElement("div");
    p.className = "featured-desc";
    p.textContent = description;
    const meta = document.createElement("div");
    meta.className = "featured-meta";
    meta.textContent = item.provider ? `✨ ${item.provider}` : "";
    li.append(h, p, meta);
    const open = () => openFeatured(item.slug);
    li.onclick = open;
    li.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); }
    });
    featuredList.appendChild(li);
  }
}

async function loadFeatured() {
  const { ok, data } = await api("/api/featured");
  renderFeatured(ok ? (data.featured || []) : []);
}

async function openFeatured(slug) {
  const { ok, data } = await api(`/api/featured/${slug}`);
  if (!ok || !Array.isArray(data.files) || !data.files.length) {
    addMessage("assistant", i18n.t("msg.featured_open_fail"));
    return;
  }
  const { title } = featuredText(data);
  // Read-only multi-file mode: the iframe loads /featured-files/<slug>/<entry>
  // so relative <link>/<script src> refs work; the Code tab lists every file.
  enterFeaturedMode({ slug, files: data.files, entry: data.entry, title });
  showPreviewMultiFile({ slug, entry: data.entry });
  setStatus("status.ready");
  addMessage("assistant", i18n.t("msg.featured_loaded", { title }));
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
    meta.textContent = `v${v.id} · ${v.provider} · ${formatBeijingTime(v.created_at)}${badge}`;
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

// Whether the currently selected model accepts image input (from /api/models
// `vision`). Drives the attach button's enabled state so users can't stage
// images for a text-only model.
function selectedModelVision() {
  const id = selectedModelId();
  const m = availableModels.find((x) => x.id === id);
  return !!(m && m.vision);
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
  syncAttachButton();   // enable/disable image attach for the resolved model
}

modelSelect.addEventListener("change", () => {
  localStorage.setItem(MODEL_STORE_KEY, modelSelect.value);
  maybePromptByok();
  syncAttachButton();
});

// --- multimodal input: image attachments + voice ------------------------
// Images are staged locally as base64 data URLs and sent with the next
// generate request (only to vision-capable models). Voice uses the browser's
// Web Speech API to transcribe straight into the textarea — no server round
// trip, no key.

// Enable the attach button only when the selected model accepts images; when a
// text-only model is picked, disable it and drop anything already staged so we
// never send images the model would choke on.
function syncAttachButton() {
  const vision = selectedModelVision();
  attachBtn.disabled = !vision;
  attachBtn.title = i18n.t(vision ? "app.attach_image" : "app.attach_image_disabled");
  if (!vision && attachedImages.length) {
    attachedImages = [];
    renderAttachments();
  }
}

function renderAttachments() {
  attachStrip.innerHTML = "";
  attachedImages.forEach((src, idx) => {
    const thumb = document.createElement("div");
    thumb.className = "attach-thumb";
    const img = document.createElement("img");
    img.src = src;
    img.alt = "";
    const rm = document.createElement("button");
    rm.type = "button";
    rm.className = "attach-remove";
    rm.textContent = "✕";
    rm.title = i18n.t("app.attach_remove");
    rm.addEventListener("click", () => {
      attachedImages.splice(idx, 1);
      renderAttachments();
    });
    thumb.append(img, rm);
    attachStrip.appendChild(thumb);
  });
  attachStrip.classList.toggle("hidden", attachedImages.length === 0);
}

function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function stageImages(fileList) {
  const files = Array.from(fileList || []).filter((f) => f.type.startsWith("image/"));
  for (const file of files) {
    if (attachedImages.length >= MAX_IMAGES) {
      addMessage("assistant", i18n.t("msg.image_limit", { max: MAX_IMAGES }));
      break;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      addMessage("assistant", i18n.t("msg.image_too_big", { name: file.name }));
      continue;
    }
    try {
      attachedImages.push(await readFileAsDataURL(file));
    } catch {
      addMessage("assistant", i18n.t("msg.image_read_fail", { name: file.name }));
    }
  }
  renderAttachments();
}

attachBtn.addEventListener("click", () => {
  if (requireLogin()) return;
  if (!attachBtn.disabled) imageInput.click();
});
imageInput.addEventListener("change", () => {
  stageImages(imageInput.files);
  imageInput.value = "";   // allow re-picking the same file
});
// The moment a guest tries to put content into the composer (type / paste /
// IME commit), send them to log in first — before the character even lands.
// beforeinput (not focus) is used so the several programmatic promptEl.focus()
// calls never trip the redirect for a logged-in user.
promptEl.addEventListener("beforeinput", (e) => {
  if (requireLogin(e.data)) e.preventDefault();
});
// Paste an image straight into the composer (common flow for screenshots).
promptEl.addEventListener("paste", (e) => {
  if (requireLogin(e.clipboardData?.getData("text"))) { e.preventDefault(); return; }
  if (attachBtn.disabled) return;
  const items = Array.from(e.clipboardData?.items || []);
  const files = items.filter((it) => it.kind === "file" && it.type.startsWith("image/"))
                     .map((it) => it.getAsFile()).filter(Boolean);
  if (files.length) { e.preventDefault(); stageImages(files); }
});

// --- voice input (Web Speech API) ---------------------------------------
// Transcribes speech into the textarea. Supported mainly in Chrome/Edge; when
// unavailable we hide the mic button entirely rather than show a dead control.
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;
let listening = false;

function setupVoice() {
  if (!SpeechRecognition) {
    micBtn.classList.add("hidden");   // no support -> no button
    return;
  }
  recognition = new SpeechRecognition();
  recognition.continuous = false;
  recognition.interimResults = false;
  // Match the UI language so recognition picks the right model.
  recognition.lang = i18n.getLang() === "zh" ? "zh-CN" : "en-US";

  recognition.addEventListener("result", (e) => {
    const text = Array.from(e.results).map((r) => r[0].transcript).join("");
    if (!text) return;
    // Append to whatever is already typed, with a space if needed.
    const sep = promptEl.value && !promptEl.value.endsWith(" ") ? " " : "";
    promptEl.value = promptEl.value + sep + text;
    promptEl.focus();
  });
  const stop = () => { listening = false; micBtn.classList.remove("listening"); };
  recognition.addEventListener("end", stop);
  recognition.addEventListener("error", (e) => {
    stop();
    if (e.error !== "aborted" && e.error !== "no-speech") {
      addMessage("assistant", i18n.t("msg.voice_error"));
    }
  });
}

micBtn.addEventListener("click", () => {
  if (requireLogin()) return;
  if (!recognition) return;
  if (listening) { recognition.stop(); return; }
  recognition.lang = i18n.getLang() === "zh" ? "zh-CN" : "en-US";
  try {
    recognition.start();
    listening = true;
    micBtn.classList.add("listening");
  } catch { /* start() throws if already started; ignore */ }
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
  } else if (createIdemKey) {
    // Create: carry the idempotency key so a retry/replay of this one request
    // resolves to the same project instead of forking a duplicate.
    body.idempotency_key = createIdemKey;
  }
  // Attach images locked in for this request only for vision-capable models.
  // The server also drops them for text-only specs, but gating here saves
  // bandwidth on the round trip.
  if (pendingImages.length && selectedModelVision()) {
    body.images = pendingImages.slice();
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
  if (projectId) {
    // Clear the optimistic placeholder before refreshing: loadProjects() will
    // re-render with the real, persisted row. Clearing the flag (without an
    // extra render here) lets the placeholder stay visible until the fetch
    // resolves, so the real row replaces it seamlessly with no empty flash.
    pendingProjectTitle = null;
    loadProjects();
  }
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
  // Guests can't compose — send them to log in (draft is stashed + restored).
  if (requireLogin()) return;
  // Ignore re-entrant submits while a generation is in flight. Set the flag
  // synchronously here (before any await) so a fast second click can't race the
  // first into creating a duplicate project. It's cleared in finally once the
  // whole run settles — including the streaming path's fallback to generate().
  if (generating) return;
  const prompt = promptEl.value.trim();
  if (!prompt) return;
  generating = true;
  // Mint one idempotency key per CREATE submit (edits update a known project,
  // so they don't need one). Kept stable across a stream->blocking fallback so
  // that retry still maps to the same project server-side.
  createIdemKey = currentHtml == null ? newIdemKey() : null;
  // Lock in the images for this request (vision models only), echo them in the
  // user's message, then clear the staging strip. pendingImages survives a
  // stream->blocking fallback and is cleared in finally.
  pendingImages = (attachedImages.length && selectedModelVision())
    ? attachedImages.slice() : [];
  addMessage("user", prompt, pendingImages);
  promptEl.value = "";
  attachedImages = [];
  renderAttachments();
  // For a brand-new app (createIdemKey set), show an optimistic placeholder in
  // "My projects" right away — the real row won't exist until the model finishes
  // and the project is persisted. Edits update an already-listed project, so
  // they don't need one.
  if (createIdemKey && currentUser) {
    pendingProjectTitle = prompt;
    renderProjects(lastProjects);
  }
  try {
    await generateStream(prompt);
  } finally {
    generating = false;
    createIdemKey = null;
    pendingImages = [];
    // Drop the placeholder. On success afterGenerate() already refreshed the
    // list with the real row; on failure we re-render to remove the dangling
    // placeholder. Either way, clear it and repaint from the cached list.
    if (pendingProjectTitle != null) {
      pendingProjectTitle = null;
      renderProjects(lastProjects);
    }
  }
});

// Enter submits the composer; Shift+Enter (and IME composition) still insert a
// newline. Mirrors the common chat-input convention so users don't have to
// reach for the button.
promptEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    composer.requestSubmit();
  }
});

refreshBtn.addEventListener("click", loadProjects);
langToggle.addEventListener("click", () => i18n.toggle());
newAppBtn.addEventListener("click", startNewApp);

// Preview/Code tabs, file chip, and copy button.
tabPreview.addEventListener("click", () => switchTab("preview"));
tabCode.addEventListener("click", () => switchTab("code"));

// Resolve what the code-actions buttons should operate on: the currently
// active file in multi-file mode, or the whole app HTML in single-file mode.
// Returns null when nothing is loaded so the handlers can silently no-op.
function activeSource() {
  if (currentFiles) {
    const name = currentActiveFile || currentFiles[0].name;
    const f = currentFiles.find((x) => x.name === name);
    if (!f) return null;
    const ext = (name.match(/\.[^.]+$/) || [""])[0].toLowerCase();
    const type = ext === ".css" ? "text/css"
      : ext === ".js" ? "application/javascript"
      : ext === ".json" ? "application/json"
      : "text/html";
    return { name, content: f.content, mime: `${type};charset=utf-8` };
  }
  if (currentHtml != null) {
    return { name: appFilename(), content: currentHtml, mime: "text/html;charset=utf-8" };
  }
  return null;
}

codeCopy.addEventListener("click", async () => {
  const src = activeSource();
  if (!src) return;
  try {
    await navigator.clipboard.writeText(src.content);
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
  const src = activeSource();
  if (!src) return;
  const blob = new Blob([src.content], { type: src.mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = src.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  addMessage("assistant", i18n.t("msg.downloaded"));
});

codeOpen.addEventListener("click", () => {
  // Featured (multi-file) apps: open the entry through the static endpoint so
  // the standalone tab keeps working relative refs (css/js). Everything else:
  // ship the current file as a blob URL so the new tab runs at its own origin.
  if (currentFiles && currentFilesSlug) {
    const entry = currentFiles[0]?.name || "index.html";
    window.open(`/featured-files/${encodeURIComponent(currentFilesSlug)}/${encodeURIComponent(entry)}`,
                "_blank", "noopener");
    return;
  }
  const src = activeSource();
  if (!src) return;
  const blob = new Blob([src.content], { type: src.mime });
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
  renderFeatured(lastFeatured);
  renderModelOptions();
  renderMode();
  syncAttachButton();   // refresh the attach tooltip in the new language
  if (recognition) {    // keep voice recognition in sync with the UI language
    recognition.lang = i18n.getLang() === "zh" ? "zh-CN" : "en-US";
  }
  statusEl.textContent = i18n.t(statusKey);
});

// init
(async function init() {
  renderMode();
  setupVoice();
  await loadModels();
  await loadByokPresets();
  await loadMe();
  restoreDraft();   // bring back a guest's stashed draft after they logged in
  await loadFeatured();   // public showcase — visible to guests too
  await loadProjects();
})();
