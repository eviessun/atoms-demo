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
      "app.model": "模型",
      "app.model_free": "免费",
      "app.model_tooltip": "选择用于生成的模型",
      "app.model_byok_settings": "配置自备 Key",
      // BYOK dialog
      "byok.title": "自定义模型（自备 Key）",
      "byok.intro": "填入你自己的 API Key，用你的账号调用任意模型。Key 只保存在本浏览器，随请求临时发送，服务器不会存储。",
      "byok.provider": "服务商",
      "byok.base_url": "API 地址（Base URL）",
      "byok.model": "模型名称",
      "byok.key": "API Key",
      "byok.transport": "接口类型",
      "byok.transport_openai": "OpenAI 兼容",
      "byok.transport_anthropic": "Anthropic (Claude)",
      "byok.docs": "如何申请 Key ↗",
      "byok.save": "保存",
      "byok.cancel": "取消",
      "byok.clear": "清除已存 Key",
      "byok.saved": "已保存自备 Key，下拉里选“自定义（自备 Key）”即可使用。",
      "byok.cleared": "已清除本地保存的自备 Key。",
      "byok.err.key": "请填写 API Key",
      "byok.err.model": "请填写模型名称",
      "byok.err.base_url": "请填写 API 地址（Base URL）",
      "byok.not_configured": "尚未配置自备 Key，请先点击右上角“配置自备 Key”。",
      "byok.security": "🔒 Key 仅存于本机浏览器（localStorage），不会上传保存。",
      "app.intro": "描述一个应用，我来帮你生成，并在右侧预览。",
      "app.intro_hint": "试试：“一个带开始/暂停的番茄钟和任务清单”。",
      "app.prompt_ph": "描述你想要的应用…",
      "app.generate": "生成",
      "app.attach_image": "添加图片（当前模型支持识图）",
      "app.attach_image_disabled": "当前模型不支持图片，换用带“识图”的模型即可上传",
      "app.attach_remove": "移除这张图片",
      "app.voice_input": "语音输入（说话自动转文字）",
      "app.iterate": "修改",
      "app.new_app": "＋ 新应用",
      "app.mode_new": "新建应用",
      "app.mode_edit": "正在修改：{name}",
      "app.mode_featured": "精选预览：{name}",
      "app.mode_edit_hint": "继续输入修改要求，如“把按钮改成绿色”“加一个重置按钮”。",
      "app.prompt_ph_edit": "描述要修改的地方…",
      "app.projects": "我的项目",
      "app.projects_empty_guest": "登录后即可保存并回看你的应用。",
      "app.projects_empty_none": "还没有应用，快生成一个吧！",
      "app.project_pending": "生成中…",
      "app.project_pending_meta": "正在保存新应用",

      // featured showcase (public gallery)
      "app.featured": "精选作品",
      "app.featured_hint": "无需登录，点开即可预览",
      "msg.featured_loaded": "已打开精选作品「{title}」。这是只读示例，不能在它上面修改；右侧「代码」标签里可以看 index.html / style.css / app.js 各自的源码。想做类似的？点底部「＋ 新应用」，从零描述一个属于你自己的应用。",
      "msg.featured_login_hint": "想基于它生成属于自己的应用，请先登录 / 注册：",
      "msg.featured_open_fail": "无法打开这个精选作品，请稍后重试。",

      // version history + rollback
      "app.history": "版本历史",
      "app.history_open": "查看版本历史",
      "app.history_none": "还没有历史版本。",
      "app.history_current": "当前",
      "app.version_preview": "预览",
      "app.version_restore": "回滚到此版本",
      "msg.version_previewing": "正在预览版本 v{id}（尚未回滚）。满意就点“回滚到此版本”。",
      "msg.version_restored": "已回滚到版本 v{id}，并记为新版本（历史不会丢失，可再往回滚）。",
      "msg.version_restore_fail": "回滚失败：{msg}",
      "app.preview": "实时预览",
      "app.tab_preview": "预览",
      "app.tab_code": "代码",
      "app.files": "文件",
      "app.copy": "复制代码",
      "app.download": "下载当前文件",
      "app.open_tab": "在新标签页打开（真机运行）",
      "msg.downloaded": "已下载 index.html —— 双击即可在浏览器打开运行。",
      "msg.copied": "已复制源码到剪贴板。",
      "app.preview_ph_title": "应用预览会显示在这里",
      "app.preview_ph_hint": "在左侧描述一个应用，然后点击“生成”。",
      "status.idle": "空闲",
      "status.generating": "生成中",
      "status.ready": "完成",
      "status.error": "出错",
      "status.streaming": "连接模型中…",
      "status.streaming_model": "正在生成 · {model}",

      // streaming (live reasoning + code)
      "app.reasoning": "💭 推理过程",
      "app.generating_code": "正在生成代码…",

      // dynamic app messages
      "msg.generating": "正在生成你的应用…",
      "msg.editing": "正在按你的要求修改…",
      "msg.done": "完成 —— 已在右侧渲染（使用 {provider}）{saved}。",
      "msg.done_edit": "已更新 —— 修改已应用（使用 {provider}）{saved}。",
      "msg.saved_suffix": "（已保存为 #{id}）",
      "msg.updated_suffix": "（已更新 #{id}）",
      "msg.loaded": "已加载保存的应用 #{id}：“{prompt}”。你可以继续输入修改要求。",
      "msg.open_fail": "无法打开项目 #{id}。",
      "msg.new_app": "已开始新应用，请描述你想要的应用。",
      "msg.error": "出错：{msg}",
      "msg.image_limit": "最多只能上传 {max} 张图片。",
      "msg.image_too_big": "图片“{name}”太大了（超过 5MB），已跳过。",
      "msg.image_read_fail": "无法读取图片“{name}”，已跳过。",
      "msg.voice_error": "语音识别出错，请重试或改用文字输入。",
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
      "app.model": "Model",
      "app.model_free": "free",
      "app.model_tooltip": "Choose the model used for generation",
      "app.model_byok_settings": "Configure your own key",
      // BYOK dialog
      "byok.title": "Custom model (your own key)",
      "byok.intro": "Enter your own API key to call any model on your account. The key is stored only in this browser and sent with each request — the server never stores it.",
      "byok.provider": "Provider",
      "byok.base_url": "API base URL",
      "byok.model": "Model name",
      "byok.key": "API key",
      "byok.transport": "API type",
      "byok.transport_openai": "OpenAI-compatible",
      "byok.transport_anthropic": "Anthropic (Claude)",
      "byok.docs": "How to get a key ↗",
      "byok.save": "Save",
      "byok.cancel": "Cancel",
      "byok.clear": "Clear saved key",
      "byok.saved": "Your key is saved — pick “Custom (your own key)” in the dropdown to use it.",
      "byok.cleared": "Cleared the locally saved key.",
      "byok.err.key": "Please enter an API key",
      "byok.err.model": "Please enter a model name",
      "byok.err.base_url": "Please enter the API base URL",
      "byok.not_configured": "No key configured yet — click “Configure your own key” at the top right first.",
      "byok.security": "🔒 The key stays in your browser (localStorage) and is never uploaded for storage.",
      "app.intro": "Describe an app and I'll build it, then preview it on the right.",
      "app.intro_hint": "Try: “a pomodoro timer with start/pause and a task list”.",
      "app.prompt_ph": "Describe the app you want…",
      "app.generate": "Generate",
      "app.attach_image": "Attach image (this model can read images)",
      "app.attach_image_disabled": "This model can't read images — switch to a vision model to upload",
      "app.attach_remove": "Remove this image",
      "app.voice_input": "Voice input (speech to text)",
      "app.iterate": "Update",
      "app.new_app": "＋ New app",
      "app.mode_new": "New app",
      "app.mode_edit": "Editing: {name}",
      "app.mode_featured": "Featured preview: {name}",
      "app.mode_edit_hint": "Keep typing changes, e.g. “make the button green”, “add a reset button”.",
      "app.prompt_ph_edit": "Describe what to change…",
      "app.projects": "My projects",
      "app.projects_empty_guest": "Log in to save & revisit your apps.",
      "app.projects_empty_none": "No apps yet — generate one!",
      "app.project_pending": "Generating…",
      "app.project_pending_meta": "Saving your new app",

      // featured showcase (public gallery)
      "app.featured": "Featured",
      "app.featured_hint": "No login needed — click to preview",
      "msg.featured_loaded": "Opened the featured app “{title}”. It's a read-only sample — you can't edit this one; flip to the Code tab to browse index.html / style.css / app.js. Want something like it? Hit “＋ New app” at the bottom and describe your own from scratch.",
      "msg.featured_login_hint": "To build your own app from it, please log in / register first:",
      "msg.featured_open_fail": "Couldn't open this featured app, please try again.",

      // version history + rollback
      "app.history": "Version history",
      "app.history_open": "View version history",
      "app.history_none": "No previous versions yet.",
      "app.history_current": "current",
      "app.version_preview": "Preview",
      "app.version_restore": "Roll back to this version",
      "msg.version_previewing": "Previewing version v{id} (not rolled back yet). Click “Roll back to this version” if you like it.",
      "msg.version_restored": "Rolled back to version v{id}, saved as a new version (history is kept — you can roll forward again).",
      "msg.version_restore_fail": "Rollback failed: {msg}",
      "app.preview": "Live preview",
      "app.tab_preview": "Preview",
      "app.tab_code": "Code",
      "app.files": "Files",
      "app.copy": "Copy code",
      "app.download": "Download current file",
      "app.open_tab": "Open in a new tab (run it live)",
      "msg.downloaded": "Downloaded index.html — double-click to open and run it in a browser.",
      "msg.copied": "Copied the source to your clipboard.",
      "app.preview_ph_title": "Your app preview appears here",
      "app.preview_ph_hint": "Describe an app on the left and hit “Generate”.",
      "status.idle": "idle",
      "status.generating": "generating",
      "status.ready": "ready",
      "status.error": "error",
      "status.streaming": "connecting to model…",
      "status.streaming_model": "generating · {model}",

      // streaming (live reasoning + code)
      "app.reasoning": "💭 Reasoning",
      "app.generating_code": "Generating code…",

      "msg.generating": "Generating your app…",
      "msg.editing": "Applying your change…",
      "msg.done": "Done — rendered on the right (via {provider}){saved}.",
      "msg.done_edit": "Updated — your change was applied (via {provider}){saved}.",
      "msg.saved_suffix": " (saved as #{id})",
      "msg.updated_suffix": " (updated #{id})",
      "msg.loaded": "Loaded saved app #{id}: “{prompt}”. Keep typing to change it.",
      "msg.open_fail": "Couldn't open project #{id}.",
      "msg.new_app": "Started a new app — describe what you want.",
      "msg.error": "Error: {msg}",
      "msg.image_limit": "You can attach at most {max} images.",
      "msg.image_too_big": "Image “{name}” is too large (over 5MB) and was skipped.",
      "msg.image_read_fail": "Couldn't read image “{name}”, skipped.",
      "msg.voice_error": "Voice recognition failed — please retry or type instead.",
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
