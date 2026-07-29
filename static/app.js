// Atoms Demo — frontend logic (skeleton stage)
// Wires the chat composer to /api/generate and renders the returned HTML
// into the sandboxed preview iframe via srcdoc.

const messagesEl = document.getElementById("messages");
const composer = document.getElementById("composer");
const promptEl = document.getElementById("prompt");
const sendBtn = document.getElementById("send");
const statusEl = document.getElementById("status");
const previewEl = document.getElementById("preview");
const providerBadge = document.getElementById("provider-badge");

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

async function loadHealth() {
  try {
    const res = await fetch("/api/health");
    const data = await res.json();
    providerBadge.textContent = `provider: ${data.llm_provider}`;
  } catch {
    providerBadge.textContent = "provider: ?";
  }
}

async function generate(prompt) {
  sendBtn.disabled = true;
  setStatus("generating");
  addMessage("assistant", "Generating your app…");
  try {
    const res = await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt }),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || `HTTP ${res.status}`);
    }
    previewEl.srcdoc = data.html;
    setStatus("ready");
    addMessage("assistant", `Done — rendered on the right (via ${data.provider}).`);
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

loadHealth();
