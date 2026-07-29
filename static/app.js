// Atoms Demo — frontend logic
// Wires the composer to /api/generate, renders returned HTML into the sandboxed
// preview iframe, and adds auth + a "My projects" list backed by the API.

const messagesEl = document.getElementById("messages");
const composer = document.getElementById("composer");
const promptEl = document.getElementById("prompt");
const sendBtn = document.getElementById("send");
const statusEl = document.getElementById("status");
const previewEl = document.getElementById("preview");
const providerBadge = document.getElementById("provider-badge");
const authBox = document.getElementById("auth-box");
const projectsList = document.getElementById("projects-list");
const refreshBtn = document.getElementById("refresh-projects");

let currentUser = null;

function addMessage(role, text) {
  const div = document.createElement("div");
  div.className = `msg ${role}`;
  const p = document.createElement("p");
  p.textContent = text;
  div.appendChild(p);
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function setStatus(s) {
  statusEl.textContent = s;
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
    out.textContent = "Log out";
    out.onclick = logout;
    authBox.append(who, out);
  } else {
    const email = document.createElement("input");
    email.type = "email"; email.placeholder = "email"; email.id = "auth-email";
    const pw = document.createElement("input");
    pw.type = "password"; pw.placeholder = "password"; pw.id = "auth-pw";
    const login = document.createElement("button");
    login.textContent = "Log in"; login.onclick = () => submitAuth("login");
    const reg = document.createElement("button");
    reg.className = "ghost"; reg.textContent = "Register";
    reg.onclick = () => submitAuth("register");
    authBox.append(email, pw, login, reg);
  }
}

async function submitAuth(kind) {
  const email = document.getElementById("auth-email").value.trim();
  const password = document.getElementById("auth-pw").value;
  if (!email || !password) return;
  const { ok, data } = await api(`/api/auth/${kind}`, {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  if (!ok) {
    addMessage("assistant", `Auth error: ${data.error || "failed"}`);
    return;
  }
  currentUser = { id: data.id, email: data.email };
  renderAuth();
  addMessage("assistant", `Signed in as ${data.email}. Your generations will be saved.`);
  loadProjects();
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
  projectsList.innerHTML = "";
  if (!currentUser) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = "Log in to save & revisit your apps.";
    projectsList.appendChild(li);
    return;
  }
  if (!items.length) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = "No apps yet — generate one!";
    projectsList.appendChild(li);
    return;
  }
  for (const p of items) {
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
  if (!ok) { addMessage("assistant", `Couldn't open project #${id}.`); return; }
  previewEl.srcdoc = data.html;
  setStatus("ready");
  addMessage("assistant", `Loaded saved app #${id}: “${data.prompt}”.`);
}

// --- generate ------------------------------------------------------------

async function loadHealth() {
  const { ok, data } = await api("/api/health");
  providerBadge.textContent = ok ? `provider: ${data.llm_provider}` : "provider: ?";
}

async function generate(prompt) {
  sendBtn.disabled = true;
  setStatus("generating");
  addMessage("assistant", "Generating your app…");
  try {
    const { ok, status, data } = await api("/api/generate", {
      method: "POST",
      body: JSON.stringify({ prompt }),
    });
    if (!ok) throw new Error(data.error || `HTTP ${status}`);
    previewEl.srcdoc = data.html;
    setStatus("ready");
    const saved = data.project_id ? ` (saved as #${data.project_id})` : "";
    addMessage("assistant", `Done — rendered on the right (via ${data.provider})${saved}.`);
    if (data.project_id) loadProjects();
  } catch (err) {
    setStatus("error");
    addMessage("assistant", `Error: ${err.message}`);
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

// init
(async function init() {
  await loadHealth();
  await loadMe();
  await loadProjects();
})();
