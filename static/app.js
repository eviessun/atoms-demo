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
