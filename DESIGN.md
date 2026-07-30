# DESIGN — Atoms Demo 架构与设计说明 / Architecture & Design Notes

> 本文档分为两部分：**上半部分为中文，下半部分为 English**，两部分内容一一对应。
> 面向评审：解释**做了什么、为什么这样做、如何验收**。README（[中文](./README.zh-CN.md) /
> [English](./README.md)）讲"怎么跑"，本文讲"怎么设计的、取舍在哪"。

- 在线体验 / Live demo: https://atoms-demo-lted.onrender.com
- 源码 / Source: https://github.com/eviessun/atoms-demo

---

# 中文

## 1. 它是什么

一个迷你 AI 应用生成器。用户用自然语言描述想要的网页应用，后端把需求交给
LLM，LLM 返回一个**自包含的单文件 HTML**（内联 CSS/JS），前端在**沙箱 iframe** 里实时
渲染。登录用户的每次生成会被保存为一个"项目"，之后可以在对话里继续下达修改指令，模型
在当前 HTML 上**原地迭代**——这一步让它从"一次性生成器"变成有 Agent 味道的工具。

---

## 2. 架构总览

```
                          ┌─────────────────────────────────────────┐
   Browser (静态前端)      │  FastAPI (app/main.py)                    │
   index.html / login.html│                                           │
        │  fetch JSON      │  /api/health   /api/models                │
        │ ───────────────► │  /api/auth/*   (cookie session)           │
        │                  │  /api/generate ──► llm.py ──► ModelSpec   │
        │  ◄─────────────  │  /api/projects ──► db.py                  │
        │  { html, ... }   │                    │                      │
   iframe srcdoc 渲染       └────────────────────┼──────────────────────┘
   (sandbox)                                     │
                                    ┌────────────┴────────────┐
                                    │  db.py 双后端            │
                                    │  DATABASE_URL? Postgres  │
                                    │  否则          SQLite    │
                                    └──────────────────────────┘
                          llm.py transport: mock / openai兼容 / anthropic
```

前端是无构建的静态页，只通过 JSON API 与后端通信。后端 FastAPI 负责认证、
生成编排、持久化，并把生成结果（HTML 字符串）返回给前端渲染。三个可替换的边界：
① LLM（`llm.py` + 模型注册表）② 数据库（`db.py` 双后端）③ 前端语言（`i18n.js`）。

---

## 3. 关键设计取舍

### 3.1 LLM：注册表 + 可替换传输，而非写死 provider
不把某个模型写死，而是维护 `MODEL_REGISTRY`（`app/config.py`）。每个条目声明
它用哪种传输（`mock` / OpenAI 兼容 / Anthropic）、base_url、模型名、**哪个环境变量
存它的 key**，以及是否 **`vision`（能否读图）**。前端只发送 model `id`，key 永远只在服务端读取。
- **为什么**：满足"先用免费模型、以后能接 GPT/Claude"的诉求——加模型 = 加一行注册表 +
  配一个 key，其余代码不动。DeepSeek/豆包/Kimi/OpenRouter/OpenAI 都是 OpenAI 兼容，复用同一段传输代码。
- **安全**：API key 不下发到浏览器，避免前端泄露。
- **韧性**：`LLM_FALLBACK_TO_MOCK=true` 时，选中的模型出错（key 失效/额度/网络）会降级到
  mock，而不是让核心动作直接失败——线上演示更稳。

### 3.2 mock 模型：让"无 key 也能演示全链路"
`mock` 传输不需要任何 key，返回一个真的能交互的示例 HTML。编辑模式下它会把每次
修改追加进一个可见的"变更日志"，所以**没有真实 LLM 也能演示迭代**。这让"先部署上线、再接
真实模型"成为可能，避免部署被 key 卡住。

### 3.3 生成 vs. 迭代：服务端持有权威 HTML
`/api/generate` 有两种模式：
- **新建**（无 `project_id`/`base_html`）：从零生成；登录用户会新建一条项目。
- **迭代**：把当前 HTML 连同修改指令一起喂回模型，要求返回完整更新后的 HTML。
  - 登录 + `project_id`：**基准 HTML 由服务端按 user_id 从该用户自己的项目取**（客户端无法
    伪造基准），并原地更新同一条项目。
  - 游客：用客户端传来的 `base_html`。
- **为什么服务端取基准**：更安全（防越权/伪造），且项目列表不会因为迭代而堆积重复条目。

### 3.4 持久化：双后端，一套接口
`db.py` 在导入时按 `DATABASE_URL` 选后端：有则 Postgres（psycopg 3），无则
SQLite。两者暴露相同函数；SQL 用 `?` 占位符写，Postgres 下自动转成 `%s`；插入返回 id 时
桥接 SQLite 的 `lastrowid` 与 Postgres 的 `RETURNING id`。
- **为什么**：本地零配置（SQLite），线上持久（Neon Postgres）。Render 免费档磁盘是临时的，
  只有接外部 Postgres 才能跨重新部署保存数据——这是笔试"数据持久化"硬指标的关键。

### 3.5 认证：只用标准库
密码用 `hashlib.pbkdf2_hmac`（SHA-256，20 万轮）哈希，不引入 bcrypt/argon2 —— 避免
在 Render 上现场编译原生扩展。会话是 `secrets` 生成的随机 token，存 DB + httponly cookie。
cookie 的 `Secure` 标记按请求真实协议自适应（读 `X-Forwarded-Proto`），所以线上 HTTPS 带
Secure、本地 HTTP 也能登录测试。

### 3.6 预览沙箱
生成的 HTML 通过 iframe 的 `sandbox="allow-scripts allow-forms allow-modals"`
渲染 —— 允许它自己跑脚本/表单，但**无同源权限**，不能访问父页面的 cookie/DOM。空闲时显示
深色占位图，避免白色 iframe 在深色主题下的突兀空白。

### 3.7 国际化
`i18n.js` 维护 zh/en 词典，通过 `data-i18n` 等属性在运行时替换文案；语言存
localStorage，切换时派发 `langchange` 事件，动态渲染的内容（状态、消息、项目列表）监听该
事件重渲染。默认中文。语言切换按钮**显示当前语言**（`🌐 中` / `🌐 EN`）并带悬停提示，让用户
一眼知道现在是什么语言、且可切换。

### 3.8 多模态输入：图片上传 + 语音转写
输入框除文本外还支持**图片**与**语音**。
- **图片**：以 base64 data URL 装进 JSON body（不引入 multipart 依赖），随生成请求发送。
  两侧双重门控——前端按所选模型的 `vision` 能力**置灰上传按钮**并清空已选图片，服务端也会
  为非 vision 模型**丢弃图片**，防止陈旧的客户端选择把图片发给纯文本模型。`llm.py` 按传输
  类型构造多模态消息（OpenAI 的 `image_url` 列表 / Anthropic 的 base64 `source` 块）。
  `main.py` 对图片做清洗：只收合法的 `data:image/...;base64,` URL，限张数（`MAX_IMAGES`）与大小。
- **语音**：走浏览器 **Web Speech API**（`SpeechRecognition`）在前端直接转写进输入框——
  **零后端、零成本、零 key**。识别语言随 i18n（`zh-CN` / `en-US`）。浏览器不支持时（如
  Safari/Firefox 支持有限）**直接隐藏麦克风按钮**，而不是留一个坏控件。
- **为什么这么切**：图片只对确认支持识图的模型开放（豆包 / Gemma / GPT-4o / Claude / BYOK），
  其余保守标为纯文本；语音选浏览器原生方案，避免为一个辅助输入引入服务端转写成本与依赖。

---

## 4. 数据模型

```
users                         sessions                projects
─────                         ────────                ────────
id            PK              token      PK           id          PK
email  UNIQUE                 user_id  → users.id     user_id   → users.id
password_hash                 created_at              prompt      # 最近一次需求/指令
created_at                                            html        # 当前应用 HTML
                                                      provider    # 产出该版本的模型
                                                      created_at
```

`projects.prompt`/`provider` 记录**最近一次**修改的指令与所用模型（迭代会覆盖，
列表只展示最新状态）。`projects` 查询一律带 `user_id`，实现按 owner 隔离。

---

## 5. API 契约

**`POST /api/generate`** — request:
```jsonc
{
  "prompt": "一个番茄钟",      // required
  "model": "deepseek-chat",    // optional; 缺省用服务端默认模型
  "project_id": 12,            // optional; 登录用户在此项目上原地迭代
  "base_html": "<!doctype...", // optional; 游客迭代用的当前 HTML
  "images": ["data:image/png;base64,..."]  // optional; 仅对 vision 模型生效，非 vision 服务端丢弃
}
```
response:
```jsonc
{
  "html": "<!doctype html>...",     // 生成/更新后的完整 HTML
  "provider": "DeepSeek Chat",      // 实际使用的模型 label（回退时形如 "X → Mock (fallback)"）
  "project_id": 12,                 // 登录用户：保存/更新的项目 id；游客为 null
  "iterated": true                  // true=在已有项目上迭代，false=新建
}
```

**`GET /api/models`** — response（**绝不含 key**）:
```jsonc
{ "models": [ { "id": "openrouter-nemotron-nano-free", "label": "Nemotron 3 Nano 30B",
                "free": true, "transport": "openai", "byok": false, "vision": false } ],
  "default": "openrouter-nemotron-nano-free" }
```
注：只列**已配置 key** 的模型 + 常驻的 `byok`；keyless 的 `mock` 被标记 `hidden`，
不在下拉里出现，但仍作为服务端兜底/降级目标存在。`default` 也不会落在 `mock` 上——
一旦有真实模型可用，就自动选中第一个（见 `default_model_id()`）。`vision=true` 的模型才
接受图片，前端据此置灰上传按钮、服务端据此丢弃图片。

错误以 `{"error": "..."}` + 恰当 HTTP 码返回（400 参数、401 未登录、404 找不到/
越权、409 邮箱已注册、502 生成失败）。

---

## 6. 部署与运维

- 平台：Render 免费 Web Service；`render.yaml` 声明运行时、启动命令、健康检查、需要的密钥
  （密钥用 `sync: false`，在 Dashboard 手填，不进 git）。
- Python 版本锁 `3.12.7`（`.python-version`）：Render 默认可能用 Python 3.14，`pydantic-core`
  无对应预编译 wheel，会现场用 Rust 编译并在只读文件系统失败。锁 3.12 直接用 wheel。
- 持久化：Render 后台配 `DATABASE_URL`=Neon 连接串；不配则退回临时 SQLite，重新部署丢数据。
- 保活：`.github/workflows/keep-alive.yml` 每 10 分钟 ping `/api/health`，缓解免费实例休眠。

---

## 7. 验收指引（给评审）

建议按此顺序体验 https://atoms-demo-lted.onrender.com ：
1. **首屏**：默认中文；右上角有语言切换（`🌐 中`）、模型下拉、"登录/注册"入口。
2. **中英切换**：点 `🌐 中` → 全站变英文，按钮变 `🌐 EN`；刷新后保持。
3. **注册**：点"登录/注册" → 独立登录页（tab 切换、密码显隐、友好错误）→ 注册后回主页。
4. **生成**：输入"一个带开始/暂停的番茄钟" → 点生成 → 右侧 iframe 实时渲染，左侧"我的项目"多一条。
5. **迭代（Agent 关键）**：生成后输入框上方出现"正在修改…"，再输入"加一个任务清单" →
   在同一应用上原地更新，项目列表不新增重复项。点"＋ 新应用"可重新开始。
6. **持久化**：退出登录再登录，或隔一段时间再来，项目仍在（数据存 Neon Postgres）。

> 首次访问若实例在休眠，需等 ~30–60 秒唤醒，属正常。

---

## 8. 已知取舍与后续

- 版本历史用 append-only 的 `project_versions` 表：每次生成/迭代/回滚都追加一条快照，
  `projects.html` 始终指向"当前"版本；回滚是**非破坏性**的（回滚本身也记为新版本，历史永不截断）。
- 生成走 **SSE 流式**（实时展示推理过程与代码逐字写出）；mock / 非流式传输则用分块模拟动画。
- 生成的应用可**导出**：下载单文件 `index.html`、复制源码、或在新标签页真机运行（脱离沙箱 iframe）。
- 线上默认走一个真实免费模型（OpenRouter Nemotron Nano 30B）；`mock` 被标 `hidden`，
  只当兜底/降级目标，不出现在下拉里。配好 `OPENROUTER_API_KEY` 后默认会自动指向真实模型，
  无需改码、也无需再动 `DEFAULT_MODEL_ID` 环境变量。
- 免费档休眠 + 冷启动是平台限制，靠保活 ping 缓解。

---

# English

## 1. What it is

A mini AI app builder. The user describes a web app in natural
language; the backend sends the request to an LLM, which returns a **self-contained
single-file HTML** (inline CSS/JS); the frontend renders it live in a **sandboxed
iframe**. For logged-in users each generation is saved as a "project", and they can
then issue follow-up change requests in chat — the model **edits the current HTML
in place**. That iterate loop is what turns it from a one-shot generator into an
agent-like tool.

---

## 2. Architecture

```
                          ┌─────────────────────────────────────────┐
   Browser (static SPA)   │  FastAPI (app/main.py)                    │
   index.html / login.html│                                           │
        │  fetch JSON      │  /api/health   /api/models                │
        │ ───────────────► │  /api/auth/*   (cookie session)           │
        │                  │  /api/generate ──► llm.py ──► ModelSpec   │
        │  ◄─────────────  │  /api/projects ──► db.py                  │
        │  { html, ... }   │                    │                      │
   iframe srcdoc render    └────────────────────┼──────────────────────┘
   (sandbox)                                     │
                                    ┌────────────┴────────────┐
                                    │  db.py dual backend      │
                                    │  DATABASE_URL? Postgres  │
                                    │  else          SQLite    │
                                    └──────────────────────────┘
                          llm.py transport: mock / openai-compat / anthropic
```

The frontend is a build-less static page that talks to the backend
only via JSON APIs. FastAPI handles auth, generation orchestration, and
persistence, returning the generated HTML string for the frontend to render. Three
swappable seams: ① the LLM (`llm.py` + model registry), ② the database (`db.py`
dual backend), ③ the UI language (`i18n.js`).

---

## 3. Key design decisions

### 3.1 LLM: a registry + swappable transport, not a hard-wired provider
Rather than hard-wiring one model, we keep a `MODEL_REGISTRY`. Each
entry declares its transport (`mock` / OpenAI-compatible / Anthropic), base_url,
model name, **which env var holds its key**, and whether it's **`vision` (image-capable)**.
The browser sends only a model `id`; keys are read server-side.
- **Why**: satisfies "use a free model now, plug in GPT/Claude later" — adding a
  model is one registry row + one env var. DeepSeek/Doubao/Kimi/OpenRouter/OpenAI
  are all OpenAI-compatible and share one transport.
- **Security**: keys never reach the browser.
- **Resilience**: with `LLM_FALLBACK_TO_MOCK=true`, a failing model degrades to
  mock instead of hard-failing the core action.

### 3.2 The mock model: "demo the whole pipeline with no key"
The `mock` transport needs no key and returns a genuinely interactive
sample HTML. In edit mode it appends each change to a visible "change log", so the
iterate loop is demonstrable **without a real LLM**. This let us deploy first and
wire real models later, instead of being blocked on a key.

### 3.3 Create vs. iterate: the server holds the authoritative HTML
`/api/generate` has two modes:
- **Create** (no `project_id`/`base_html`): build from scratch; logged-in users get
  a new project row.
- **Iterate**: feed the current HTML + change request back to the model, asking for
  the full updated HTML.
  - Logged-in + `project_id`: **the base HTML is loaded server-side, scoped by
    user_id** (the client can't forge it), and the same project is updated in place.
  - Guest: uses the client-provided `base_html`.
- **Why load the base server-side**: safer (prevents tampering / cross-user
  access), and the project list doesn't accumulate duplicates on each iteration.

### 3.4 Persistence: dual backend, one interface
`db.py` picks the backend at import time by `DATABASE_URL`: Postgres
(psycopg 3) if set, else SQLite. Both expose identical functions; SQL is written
with `?` placeholders and rewritten to `%s` for Postgres; inserts bridge SQLite's
`lastrowid` and Postgres's `RETURNING id`.
- **Why**: zero-config locally (SQLite), durable in prod (Neon Postgres). Render's
  free disk is ephemeral, so only an external Postgres survives redeploys — the crux
  of the "data persistence" requirement.

### 3.5 Auth: standard library only
Passwords are hashed with `hashlib.pbkdf2_hmac` (SHA-256, 200k rounds)
— no bcrypt/argon2 to avoid compiling native extensions on Render. Sessions are
random `secrets` tokens stored in the DB + an httponly cookie. The cookie's `Secure`
flag adapts to the real request scheme (via `X-Forwarded-Proto`), so it's Secure on
HTTPS in prod yet still works over local HTTP for testing.

### 3.6 Preview sandbox
Generated HTML renders in an iframe with `sandbox="allow-scripts
allow-forms allow-modals"` — it can run its own scripts/forms but has **no
same-origin access** to the parent's cookies/DOM. When idle, a dark placeholder is
shown to avoid a jarring white iframe against the dark theme.

### 3.7 Internationalization
`i18n.js` holds a zh/en dictionary and swaps text at runtime via
`data-i18n` attributes; the choice persists in localStorage, and a `langchange`
event lets dynamically-rendered content (status, messages, project list) re-render.
Chinese is the default. The toggle **shows the current language** (`🌐 中` / `🌐 EN`)
with a hover tooltip, so users can tell the current language at a glance and know
it's switchable.

### 3.8 Multimodal input: image upload + voice transcription
Beyond text, the composer accepts **images** and **voice**.
- **Images** ride the generate request as base64 data URLs inside the JSON body
  (no multipart dependency). Vision is gated on **both** sides: the frontend greys
  out the attach button (and drops staged images) based on the selected model's
  `vision` flag, and the server **also drops images** for a non-vision spec so a
  stale client pick can't send images to a text-only model. `llm.py` builds the
  provider-specific multimodal message (OpenAI's `image_url` list / Anthropic's
  base64 `source` blocks); `main.py` sanitizes input to well-formed
  `data:image/...;base64,` URLs, capped by count (`MAX_IMAGES`) and size.
- **Voice** uses the browser's **Web Speech API** (`SpeechRecognition`) to
  transcribe straight into the textarea — **no backend, no cost, no key**. The
  recognition language tracks i18n (`zh-CN` / `en-US`). When unsupported (limited
  in Safari/Firefox) the mic button is **hidden** rather than shown as a dead control.
- **Why**: images are opened only to models confirmed to read them (Doubao / Gemma /
  GPT-4o / Claude / BYOK), the rest stay conservatively text-only; voice picks the
  native browser path to avoid server-side transcription cost/deps for an input aid.

---

## 4. Data model

```
users                         sessions                projects
─────                         ────────                ────────
id            PK              token      PK           id          PK
email  UNIQUE                 user_id  → users.id     user_id   → users.id
password_hash                 created_at              prompt      # latest request / instruction
created_at                                            html        # current app HTML
                                                      provider    # model that produced this version
                                                      created_at
```

`projects.prompt`/`provider` record the **latest** change request and
model (iteration overwrites them; the list shows the most recent state). All
`projects` queries are scoped by `user_id` for owner isolation.

---

## 5. API contract

**`POST /api/generate`** — request:
```jsonc
{
  "prompt": "a pomodoro timer",  // required
  "model": "deepseek-chat",      // optional; falls back to the server default model
  "project_id": 12,              // optional; logged-in user iterates in place on this project
  "base_html": "<!doctype...",   // optional; current HTML used for guest iteration
  "images": ["data:image/png;base64,..."]  // optional; only for vision models, dropped server-side otherwise
}
```
response:
```jsonc
{
  "html": "<!doctype html>...",     // full generated/updated HTML
  "provider": "DeepSeek Chat",      // label of the model actually used (on fallback, like "X → Mock (fallback)")
  "project_id": 12,                 // logged-in user: saved/updated project id; null for guests
  "iterated": true                  // true = iterated on an existing project, false = newly created
}
```

**`GET /api/models`** — response (**never contains keys**):
```jsonc
{ "models": [ { "id": "openrouter-nemotron-nano-free", "label": "Nemotron 3 Nano 30B",
                "free": true, "transport": "openai", "byok": false, "vision": false } ],
  "default": "openrouter-nemotron-nano-free" }
```
Note: only models with a **configured key** are listed, plus the always-on `byok`;
the keyless `mock` is marked `hidden` — it never appears in the dropdown but still
exists as the server-side fallback/degrade target. `default` never lands on `mock`
either — once a real model is available, the first one is auto-selected (see
`default_model_id()`). Only `vision=true` models accept images; the frontend greys
out the attach button accordingly and the server drops images accordingly.

Errors return `{"error": "..."}` with an appropriate status (400 bad
input, 401 unauthenticated, 404 not found / not owned, 409 email taken, 502
generation failed).

---

## 6. Deploy & ops

- Platform: Render free Web Service; `render.yaml` declares runtime, start command,
  health check, and required secrets (`sync: false` → filled in the dashboard, not
  in git).
- Python pinned to `3.12.7` (`.python-version`): Render may default to Python 3.14,
  for which `pydantic-core` has no prebuilt wheel and compiles via Rust, failing on
  the read-only filesystem. Pinning 3.12 uses the wheel directly.
- Persistence: set `DATABASE_URL`=Neon string in the dashboard; without it, it falls
  back to ephemeral SQLite and loses data on redeploy.
- Keep-alive: `.github/workflows/keep-alive.yml` pings `/api/health` every 10 min to
  mitigate free-instance sleep.

---

## 7. How to review

Suggested walkthrough of https://atoms-demo-lted.onrender.com :
1. **Landing**: Chinese by default; top-right has the language toggle (`🌐 中`), model
   dropdown, and a "Login/Register" entry.
2. **Switch language**: click `🌐 中` → whole app turns English, button becomes
   `🌐 EN`; persists across reloads.
3. **Register**: click Login/Register → dedicated login page (tabs, password reveal,
   friendly errors) → land back on the main page.
4. **Generate**: type "a pomodoro timer with start/pause" → Generate → the iframe
   renders live and a new item appears under "My Projects".
5. **Iterate (the agent bit)**: after generating, an "Editing…" banner appears; type
   "add a task list" → it updates the same app in place, with no duplicate list
   entry. "+ New app" starts fresh.
6. **Persistence**: log out and back in, or return later — projects are still there
   (stored in Neon Postgres).

> On first hit, if the instance is asleep, allow ~30–60s to wake — that's expected.

---

## 8. Known trade-offs & next

- Version history uses an append-only `project_versions` table: every generate/iterate/
  restore appends a snapshot, while `projects.html` always points at the "current" one.
  Rollback is **non-destructive** (the restore is itself recorded as a new version, so
  history is never truncated).
- Generation is **SSE-streamed** (live reasoning + code as it's written); mock and
  non-streaming transports fall back to a chunked simulated animation.
- The generated app can be **exported**: download the single `index.html`, copy the
  source, or open it in a new tab to run it standalone (outside the sandboxed iframe).
- Prod defaults to a real free model (OpenRouter Nemotron Nano 30B); `mock` is
  marked `hidden` — kept only as the fallback/degrade target, never shown in the
  dropdown. Once `OPENROUTER_API_KEY` is set the default auto-advances to a real
  model — no code change and no need to touch the `DEFAULT_MODEL_ID` env var.
- Free-tier sleep + cold start is a platform limit, mitigated by the keep-alive ping.
