// Login / Register page logic.
// Tab-switch between login and register, password show/hide, inline errors,
// language toggle, and redirect to the app on success.

const tabLogin = document.getElementById("tab-login");
const tabRegister = document.getElementById("tab-register");
const form = document.getElementById("auth-form");
const emailEl = document.getElementById("email");
const passwordEl = document.getElementById("password");
const pwToggle = document.getElementById("pw-toggle");
const submitBtn = document.getElementById("submit-btn");
const errorEl = document.getElementById("form-error");
const subEl = document.getElementById("auth-sub");
const langToggle = document.getElementById("lang-toggle");

let mode = "login"; // "login" | "register"

function refreshModeLabels() {
  const isLogin = mode === "login";
  submitBtn.textContent = i18n.t(isLogin ? "login.submit.login" : "login.submit.register");
  subEl.textContent = i18n.t(isLogin ? "login.sub.login" : "login.sub.register");
  passwordEl.placeholder = i18n.t(isLogin ? "login.ph.password.login" : "login.ph.password.register");
}

function setMode(next) {
  mode = next;
  const isLogin = mode === "login";
  tabLogin.classList.toggle("active", isLogin);
  tabRegister.classList.toggle("active", !isLogin);
  passwordEl.setAttribute("autocomplete", isLogin ? "current-password" : "new-password");
  refreshModeLabels();
  hideError();
}

function showError(msg) {
  errorEl.textContent = msg;
  errorEl.hidden = false;
}
function hideError() {
  errorEl.textContent = "";
  errorEl.hidden = true;
}

// Map backend error strings to friendly localized messages.
function friendlyError(status, raw) {
  const map = {
    "invalid email": "err.email_invalid",
    "password must be at least 6 chars": "err.password_min",
    "email already registered": "err.email_taken",
    "invalid email or password": "err.bad_credentials",
    "login required": "err.login_required",
  };
  if (raw && map[raw]) return i18n.t(map[raw]);
  if (status === 409) return i18n.t("err.email_taken");
  if (status === 401) return i18n.t("err.bad_credentials");
  return raw || `${i18n.t("err.generic")}（${status}）`;
}

tabLogin.addEventListener("click", () => setMode("login"));
tabRegister.addEventListener("click", () => setMode("register"));

pwToggle.addEventListener("click", () => {
  passwordEl.type = passwordEl.type === "text" ? "password" : "text";
});

langToggle.addEventListener("click", () => i18n.toggle());
// Re-render mode-dependent labels after a language switch.
window.addEventListener("langchange", refreshModeLabels);

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  hideError();
  const email = emailEl.value.trim();
  const password = passwordEl.value;

  if (!email) return showError(i18n.t("err.email_required"));
  if (!password) return showError(i18n.t("err.password_required"));
  if (mode === "register" && password.length < 6) {
    return showError(i18n.t("err.password_min"));
  }

  submitBtn.disabled = true;
  submitBtn.textContent = i18n.t(mode === "login" ? "login.submitting.login" : "login.submitting.register");
  try {
    const res = await fetch(`/api/auth/${mode}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    let data = {};
    try { data = await res.json(); } catch { /* no body */ }
    if (!res.ok) {
      showError(friendlyError(res.status, data.error));
      return;
    }
    window.location.href = "/"; // success -> app
  } catch (err) {
    showError(i18n.t("err.network"));
  } finally {
    submitBtn.disabled = false;
    refreshModeLabels();
  }
});

// Support /login?mode=register deep link.
const params = new URLSearchParams(window.location.search);
if (params.get("mode") === "register") setMode("register");
