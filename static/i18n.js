// Lightweight i18n shared by the login page and the main app.
// - Static text: mark elements with data-i18n="key" (sets textContent) or
//   data-i18n-placeholder="key" (sets the placeholder attribute).
// - Dynamic text: call i18n.t("key", {name: value}) in JS.
// Language is persisted in localStorage and defaults to Chinese.

(function () {
  const DICT = {
    zh: {
      "doc.login_title": "登录 · Atoms Demo",
      "brand": "Atoms Demo",
      "app.tagline": "用 AI 把想法变成可运行的网页应用",

      // login page
      "login.sub.login": "欢迎回来，请登录你的账户",
      "login.sub.register": "创建一个新账户，开始生成应用",
      "login.tab.login": "登录",
      "login.tab.register": "注册",
      "login.label.email": "邮箱",
      "login.label.password": "密码",
      "login.ph.password.login": "请输入密码",
      "login.ph.password.register": "设置密码（至少 6 位）",
      "login.submit.login": "登录",
      "login.submit.register": "注册",
      "login.submitting.login": "登录中…",
      "login.submitting.register": "注册中…",
      "login.back": "← 返回首页，先随便体验一下",

      // login errors
      "err.email_required": "请输入邮箱",
      "err.password_required": "请输入密码",
      "err.password_min": "密码至少需要 6 位",
      "err.email_invalid": "邮箱格式不正确",
      "err.email_taken": "该邮箱已注册，请直接登录",
      "err.bad_credentials": "邮箱或密码错误",
      "err.login_required": "请先登录",
      "err.network": "网络异常，请稍后重试",
      "err.generic": "请求失败",

      // main app
      "app.login_entry": "登录 / 注册",
      "app.logout": "退出登录",
      "app.provider": "模型",
      "app.intro": "描述一个应用，我来帮你生成，并在右侧预览。",
      "app.intro_hint": "试试：“一个带开始/暂停的番茄钟和任务清单”。",
      "app.prompt_ph": "描述你想要的应用…",
      "app.generate": "生成",
      "app.projects": "我的项目",
      "app.projects_empty_guest": "登录后即可保存并回看你的应用。",
      "app.projects_empty_none": "还没有应用，快生成一个吧！",
      "app.preview": "实时预览",
      "app.preview_ph_title": "应用预览会显示在这里",
      "app.preview_ph_hint": "在左侧描述一个应用，然后点击“生成”。",
      "status.idle": "空闲",
      "status.generating": "生成中",
      "status.ready": "完成",
      "status.error": "出错",

      // dynamic app messages
      "msg.generating": "正在生成你的应用…",
      "msg.done": "完成 —— 已在右侧渲染（使用 {provider}）{saved}。",
      "msg.saved_suffix": "（已保存为 #{id}）",
      "msg.loaded": "已加载保存的应用 #{id}：“{prompt}”。",
      "msg.open_fail": "无法打开项目 #{id}。",
      "msg.error": "出错：{msg}",
      "lang.toggle": "🌐 中",
      "lang.switch_tooltip": "切换语言 / Switch language",
    },
    en: {
      "doc.login_title": "Sign in · Atoms Demo",
      "brand": "Atoms Demo",
      "app.tagline": "Turn ideas into runnable web apps with AI",

      "login.sub.login": "Welcome back, please sign in",
      "login.sub.register": "Create a new account to start building",
      "login.tab.login": "Log in",
      "login.tab.register": "Register",
      "login.label.email": "Email",
      "login.label.password": "Password",
      "login.ph.password.login": "Enter your password",
      "login.ph.password.register": "Set a password (min 6 chars)",
      "login.submit.login": "Log in",
      "login.submit.register": "Register",
      "login.submitting.login": "Signing in…",
      "login.submitting.register": "Registering…",
      "login.back": "← Back to home, try it first",

      "err.email_required": "Please enter your email",
      "err.password_required": "Please enter your password",
      "err.password_min": "Password must be at least 6 characters",
      "err.email_invalid": "Invalid email format",
      "err.email_taken": "Email already registered, please log in",
      "err.bad_credentials": "Invalid email or password",
      "err.login_required": "Please log in first",
      "err.network": "Network error, please try again",
      "err.generic": "Request failed",

      "app.login_entry": "Log in / Register",
      "app.logout": "Log out",
      "app.provider": "provider",
      "app.intro": "Describe an app and I'll build it, then preview it on the right.",
      "app.intro_hint": "Try: “a pomodoro timer with start/pause and a task list”.",
      "app.prompt_ph": "Describe the app you want…",
      "app.generate": "Generate",
      "app.projects": "My projects",
      "app.projects_empty_guest": "Log in to save & revisit your apps.",
      "app.projects_empty_none": "No apps yet — generate one!",
      "app.preview": "Live preview",
      "app.preview_ph_title": "Your app preview appears here",
      "app.preview_ph_hint": "Describe an app on the left and hit “Generate”.",
      "status.idle": "idle",
      "status.generating": "generating",
      "status.ready": "ready",
      "status.error": "error",

      "msg.generating": "Generating your app…",
      "msg.done": "Done — rendered on the right (via {provider}){saved}.",
      "msg.saved_suffix": " (saved as #{id})",
      "msg.loaded": "Loaded saved app #{id}: “{prompt}”.",
      "msg.open_fail": "Couldn't open project #{id}.",
      "msg.error": "Error: {msg}",
      "lang.toggle": "🌐 EN",
      "lang.switch_tooltip": "Switch language / 切换语言",
    },
  };

  const STORAGE_KEY = "atoms_lang";

  function getLang() {
    return localStorage.getItem(STORAGE_KEY) || "zh";
  }

  function interpolate(str, params) {
    if (!params) return str;
    return str.replace(/\{(\w+)\}/g, (_, k) => (params[k] != null ? params[k] : ""));
  }

  function t(key, params) {
    const lang = getLang();
    const table = DICT[lang] || DICT.zh;
    const raw = table[key] != null ? table[key] : (DICT.zh[key] != null ? DICT.zh[key] : key);
    return interpolate(raw, params);
  }

  // Apply all static translations found in the DOM.
  function apply() {
    const lang = getLang();
    document.documentElement.lang = lang === "zh" ? "zh-CN" : "en";
    document.querySelectorAll("[data-i18n]").forEach((el) => {
      el.textContent = t(el.getAttribute("data-i18n"));
    });
    document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
      el.placeholder = t(el.getAttribute("data-i18n-placeholder"));
    });
    document.querySelectorAll("[data-i18n-tooltip]").forEach((el) => {
      el.title = t(el.getAttribute("data-i18n-tooltip"));
    });
    document.querySelectorAll("[data-i18n-title]").forEach((el) => {
      const key = el.getAttribute("data-i18n-title");
      if (key === "doc.login_title") document.title = t(key);
    });
  }

  function setLang(lang) {
    localStorage.setItem(STORAGE_KEY, lang);
    apply();
    window.dispatchEvent(new CustomEvent("langchange", { detail: { lang } }));
  }

  function toggle() {
    setLang(getLang() === "zh" ? "en" : "zh");
  }

  window.i18n = { t, apply, setLang, toggle, getLang };
  document.addEventListener("DOMContentLoaded", apply);
})();
