# DESIGN — Atoms Demo 架构与设计说明 / Architecture & Design Notes

[![Live Demo](https://img.shields.io/badge/🌐-在线体验-brightgreen?style=flat-square)](https://atoms-demo-lted.onrender.com)
[![Source](https://img.shields.io/badge/GitHub-源码-181717?style=flat-square&logo=github)](https://github.com/eviessun/atoms-demo)

> 本文档分为两部分：**上半部分中文，下半部分 English**，两部分内容一一对应。
> 面向评审与技术读者：解释**做了什么、为什么这样做、关键取舍在哪**。
> - 一页纸摘要（思路/完成度/扩展）→ [SUBMISSION.md](./SUBMISSION.md)
> - 运行指南 / 技术栈 / API 列表 → [README.md](./README.md)

---

# 中文

## 1. 产品定位

Atoms Demo 是一个受 Atoms / v0 / bolt.new 启发的**迷你 AI 应用生成器**。

用户用自然语言描述想要的网页应用，后端将需求交给 LLM，LLM 返回一份**自包含的单文件 HTML**（内联 CSS/JS），前端在**沙箱 iframe** 里实时渲染。登录用户的每次生成会被持久化为"项目"，之后可以在对话中继续下达修改指令——模型在当前 HTML 上**原地迭代**，把"一次性生成器"升级为有 Agent 特征的对话式构建工具。

**核心闭环**：`描述 → 生成 → 实时预览 → 保存 → 对话迭代 → 版本回滚 → 导出`。

---

## 2. 架构总览

```
┌──────────────────────────────────────────────────────────────────┐
│                       Browser（静态 SPA，无构建步骤）              │
│                                                                  │
│  ┌──────────┐   ┌──────────────┐   ┌──────────────────────────┐  │
│  │ Projects │   │  Chat Panel  │   │ Sandboxed <iframe>       │  │
│  │ (列表)    │◄──┤ (消息/输入)   │──►│ srcdoc 渲染，sandbox     │  │
│  └──────────┘   └──────┬───────┘   └──────────────────────────┘  │
│                        │ fetch JSON + SSE                        │
└────────────────────────┼─────────────────────────────────────────┘
                         │
┌────────────────────────▼─────────────────────────────────────────┐
│                     FastAPI Backend (app/)                       │
│                                                                  │
│  main.py ── /api/health · /api/models · /api/auth/*              │
│            /api/generate · /api/generate/stream (SSE)            │
│            /api/projects · /api/projects/{id}/versions           │
│            /api/featured/*  (public showcase gallery)            │
│     │                                                            │
│     ├── auth.py  — PBKDF2-HMAC-SHA256(200k rounds)               │
│     │              httponly + SameSite=Lax cookie sessions       │
│     │              Secure flag 自适应 X-Forwarded-Proto          │
│     │                                                            │
│     ├── llm.py + config.py                                       │
│     │     MODEL_REGISTRY（插件式模型表）                           │
│     │     transports: mock · openai-compatible · anthropic       │
│     │     特性标记: vision · free · byok · hidden                │
│     │     错误路径: LLM_FALLBACK_TO_MOCK → 降级而非硬失败          │
│     │                                                            │
│     └── db.py ─ 双后端抽象，一套函数接口                           │
│            DATABASE_URL 存在 → PostgreSQL (psycopg 3)            │
│            否则            → SQLite (stdlib)                     │
│            SQL 占位符 ? → %s 自动转换; lastrowid ↔ RETURNING id   │
└──────────────────────────────────────────────────────────┘
                         │
        ┌────────────────┴────────────────┐
        ▼                                 ▼
  PostgreSQL (Neon, prod)           LLM Providers
  跨重启/重新部署持久化              OpenRouter · DeepSeek · Doubao
                                   Moonshot · OpenAI · Anthropic
                                   （统一 OpenAI 兼容传输，Anthropic 单独适配）
```

**三个可替换边界**，保证扩展性而不污染核心代码：

| 边界 | 抽象点 | 替换时改动范围 |
|---|---|---|
| ① LLM | `MODEL_REGISTRY` 注册表 + transport 分发 | 加一行模型配置 + 设环境变量 |
| ② 数据库 | `db.py` 统一函数接口 + 占位符/返回值桥接 | 加新后端需实现同一组函数 |
| ③ UI 语言 | `i18n.js` 词典 + `data-i18n` 属性 + `langchange` 事件 | 加一个语言包对象 |

---

## 3. 关键设计取舍

### 3.1 LLM 层：注册表模式而非硬编码 Provider

不在代码里写死某个模型，而是维护一张 `MODEL_REGISTRY`（[app/config.py](app/config.py)），每条目声明：
- `transport`：`mock` / `openai` / `anthropic`
- `base_url` + `model`：实际请求目标
- `key_env`：**哪个环境变量读 key**（key 永不下发浏览器）
- 能力标签：`vision`（能否读图）、`free`、`byok`（用户自备 key）、`hidden`（下拉隐藏，仅服务端兜底）

**前端只发送 model `id`**，后端按 `id` 查注册表、读对应环境变量、构造请求。

**为什么这样做**：
- 新增模型（如新增 Gemini）= 加一行配置 + 设一个环境变量，不碰生成/迭代/消息构造逻辑
- DeepSeek / Doubao / Kimi / OpenRouter / OpenAI 均为 OpenAI 兼容，**复用同一段 transport 代码**，零重复
- API key 只在服务端读取，浏览器控制台抓不到，避免前端泄露

### 3.2 keyless `mock` 模型：让"无 Key 也能跑"成为第一等公民

`mock` transport 不需要任何 API key，返回一份真实可交互的示例 HTML；编辑模式下把每次修改追加到一个可见的"变更日志"里，**即使没有真实 LLM 也能完整演示迭代循环**。

这带来两个关键价值：
1. **部署不受 key 阻塞**：Render 上线第一天可以不填任何 key 就能让评审跑完整流程，之后再补真实模型 key
2. **优雅降级**：`LLM_FALLBACK_TO_MOCK=true` 时，真实模型因 key 失效/额度耗尽/网络错误失败时，自动降级到 mock，前端拿到的响应里 `provider` 字段会标注 "X → Mock (fallback)"，用户能看到生成结果而非 500

### 3.3 生成 vs 迭代：服务端持有权威 HTML

`/api/generate` 承担两种模式：

| 模式 | 触发条件 | 基准 HTML 来源 | 持久化行为 |
|---|---|---|---|
| **新建** | 无 `project_id` 且无 `base_html` | 无（从零生成） | 登录用户：插入 projects + 第一条 version；游客：仅返回 HTML |
| **迭代（登录）** | 有 `project_id` | **服务端按 `user_id` + `project_id` 从 DB 取** | 更新 projects.html + 追加一条 version 快照 |
| **迭代（游客）** | 有 `base_html`，无 `project_id` | 信任客户端传来的 `base_html` | 不持久化，仅返回新 HTML |

**为什么服务端取基准**：
- **防伪造**：客户端无法篡改"要修改哪个项目"或"在什么基础上改"，彻底避免越权
- **避免重复项目**：迭代是原地更新同一个 project_id，不会每次对话在"我的项目"里堆一行
- **幂等**：创建请求支持 `idempotency_key`，同 key 重试/重放只会返回同一个 project（[test_idempotency](tests/) 覆盖）

### 3.4 持久化：双后端一套接口

[app/db.py](app/db.py) 在**模块导入时**按 `DATABASE_URL` 环境变量选择后端：
- 有值 → PostgreSQL（通过 psycopg 3，dict_row 工厂）
- 无值 → SQLite（stdlib，`row_factory = sqlite3.Row`）

两边暴露完全相同的函数集（`create_user` / `get_project` / `append_version` 等），上层代码不感知后端差异。兼容层处理两个关键桥接：

- **占位符翻译**：SQL 统一用 `?` 写，Postgres 下自动替换为 `%s`（`_placeholders()` 辅助函数）
- **INSERT 返回 id**：SQLite 用 `cursor.lastrowid`，Postgres 用 `INSERT ... RETURNING id`；`_insert_id()` 统一这两种语义

**为什么选 SQLite 本地 + Postgres 线上**：
- 本地零配置：`git clone && pip install && uvicorn` 就能跑，不用装 Postgres
- 线上持久：Render 免费档容器磁盘是临时的，重新部署/休眠都会清空文件，必须用外部数据库才能满足笔试"数据持久化"硬要求——Neon 免费档提供 500MB 存储 + 1GB 内存，足够 Demo 规模

### 3.5 认证：只用标准库

- **密码哈希**：`hashlib.pbkdf2_hmac("sha256", password, salt, 200_000)`——stdlib，不引入 bcrypt/argon2，避免 Render 上编译 C 扩展在只读文件系统失败
- **会话**：`secrets.token_urlsafe(32)` 生成不透明 token，存 DB 表 `sessions`；通过 **httponly** cookie 下发，`SameSite=Lax` 防 CSRF
- **Secure 标记自适应**：本地 HTTP 测试不能带 Secure（否则浏览器不回传 cookie），线上 HTTPS 必须带——通过读取 `X-Forwarded-Proto`（Render 反向代理会设）判断真实协议，动态设置 cookie 的 Secure 标志
- **归属隔离**：所有 project/version 查询都带 `WHERE user_id = ?`，读他人项目返回 404（不泄露存在性）

### 3.6 预览沙箱：安全与可用的平衡

生成的 HTML 通过 `<iframe sandbox="allow-scripts allow-forms allow-modals" srcdoc="...">` 渲染。
- **允许**：应用自己的脚本运行、表单提交、alert/confirm 弹窗——保证生成的应用真能交互
- **禁止**：`allow-same-origin`（不能访问父页面 DOM/cookie/storage）、`allow-top-navigation`（不能跳走父页面）、`allow-popups`（不能弹广告窗）

空闲时 iframe 显示深色占位图（与 app 主题一致），避免空白 iframe 在深色 UI 上的视觉割裂。

### 3.7 国际化：运行时替换 + 事件驱动重渲染

[i18n.js](static/i18n.js) 维护 `zh` / `en` 两份词典，通过 `data-i18n`（文本替换）、`data-i18n-ph`（placeholder）、`data-i18n-title`（title 提示）三类属性在页面加载和语言切换时批量替换。

- 语言偏好存 `localStorage`，默认中文
- 切换时派发自定义事件 `langchange`，动态渲染的内容（状态条、chat 消息、项目列表、模型下拉 label）监听该事件主动重渲染——不依赖 DOM MutationObserver，性能可控
- 切换按钮**显示当前语言**（`🌐 中` / `🌐 EN`）而不是通用"切换语言"图标，避免用户不知道自己在什么语言状态

### 3.8 多模态输入：图片（受控开放）+ 语音（零成本原生）

**图片上传**：
- 编码为 base64 data URL 放进 JSON body（不引入 multipart 依赖，保持零构建）
- **双重门控**：前端按所选模型的 `vision` 标签**置灰附件按钮**、切换到非 vision 模型时清空已选图片；后端再次校验模型 `vision`，非 vision 直接丢弃 `images` 字段（防止旧版客户端或恶意请求绕开前端门控）
- **消息构造按 transport 走**：OpenAI 兼容走 `image_url` content 数组，Anthropic 走 base64 `source` 块（见 `llm.py` 的 `_build_messages()`）
- **输入清洗**：只接受 `data:image/(png|jpeg|gif|webp);base64,` 格式；张数上限 `MAX_IMAGES`；单张大小上限；`main.py` 解码校验 base64 合法性

**语音输入**：
- 直接用浏览器**Web Speech API**（`SpeechRecognition`），在前端转写写入 textarea
- **零后端、零成本、零 key**；识别语言跟随 i18n（`zh-CN` / `en-US`）
- 浏览器不支持时（Safari/Firefox 对 Web Speech 支持有限）**隐藏麦克风按钮**，而非留一个点了没反应的坏控件

**为什么图片要双重门控、语音走前端**：
- 给非 vision 模型塞图片只会浪费 token 且产生幻觉回答，必须双保险
- 语音是辅助输入，不值得为它引入 Whisper API 的成本与延迟；浏览器原生方案体验够用

### 3.9 幂等创建：重试不产生重复项目

创建新项目时客户端生成一个 `idempotency_key`（UUID v4），随请求发送；后端在 `projects` 表对 `(user_id, idempotency_key)` 建唯一索引：
- 同 key 重放 → 返回已存在的 project，不重复创建
- 不同 key → 正常创建
- 无 key（老客户端）→ 正常创建，不破坏兼容

网络抖动、用户双击、SSE 断连重连都不会把同一个 prompt 生成两份。

### 3.10 版本历史：Append-only + 非破坏性回滚

每次生成/迭代/回滚都向 `project_versions` 表**追加**一条快照（`id, project_id, prompt, html, provider, created_at`）；`projects.html` 始终指向"当前版本"。

回滚接口 `/api/projects/{id}/versions/{vid}/restore` 不是把 projects 指向旧快照就完事——它**把旧快照的 html 作为新快照追加一条**，回滚动作本身进入历史。好处：
- 历史永不截断，审计完整
- "回滚后再修改"不会分叉
- UI 侧版本列表里能看到"从 v3 回滚到 v1"这类操作轨迹

---

## 4. 数据模型

```
users
┌──────────────────────────────────────────┐
│ id            INTEGER PRIMARY KEY         │
│ email         TEXT UNIQUE NOT NULL        │
│ password_hash TEXT NOT NULL               │   ── PBKDF2-SHA256, 200k rounds
│ created_at    TIMESTAMP NOT NULL          │
└──────────────────────────────────────────┘
    ▲
    │ user_id
sessions
┌──────────────────────────────────────────┐
│ token         TEXT PRIMARY KEY            │   ── secrets.token_urlsafe(32)
│ user_id       INTEGER NOT NULL → users.id │
│ created_at    TIMESTAMP NOT NULL          │
└──────────────────────────────────────────┘
    ▲
    │ user_id  (所有查询必带，保证归属隔离)
projects
┌──────────────────────────────────────────┐
│ id             INTEGER PRIMARY KEY        │
│ user_id        INTEGER NOT NULL → users.id│
│ title          TEXT                       │   ── 从 prompt 自动提炼，可编辑
│ prompt         TEXT NOT NULL              │   ── 最近一次指令（迭代会覆盖）
│ html           TEXT NOT NULL              │   ── 当前生效的 HTML
│ provider       TEXT                       │   ── 最近一次所用模型 label
│ idempotency_key TEXT UNIQUE(user_id,key)  │   ── 创建幂等
│ created_at     TIMESTAMP NOT NULL         │
│ updated_at     TIMESTAMP NOT NULL         │
└──────────────────────────────────────────┘
    │
    │ project_id  (CASCADE DELETE)
    ▼
project_versions
┌──────────────────────────────────────────┐
│ id            INTEGER PRIMARY KEY         │
│ project_id    INTEGER NOT NULL            │
│ prompt        TEXT NOT NULL               │   ── 该版本的指令（create/iterate/restore）
│ html          TEXT NOT NULL               │   ── 该版本的完整 HTML 快照
│ provider      TEXT                        │
│ kind          TEXT NOT NULL DEFAULT 'gen' │   ── 'gen' | 'iter' | 'restore'
│ restored_from INTEGER                      │   ── kind='restore' 时指向被回滚到的 vid
│ created_at    TIMESTAMP NOT NULL          │
└──────────────────────────────────────────┘
```

**关键索引**：
- `projects(user_id, created_at DESC)` — 列表查询
- `project_versions(project_id, created_at DESC)` — 版本列表
- `projects(user_id, idempotency_key) UNIQUE` — 幂等创建约束
- `sessions(token)` — 会话查找（token 本身是 PK）

---

## 5. API 契约

### 5.1 核心接口

**`POST /api/generate`**（同步）/ **`POST /api/generate/stream`**（SSE 流式）

Request:
```jsonc
{
  "prompt": "一个带开始/暂停的番茄钟",     // required
  "model": "deepseek-chat",               // optional，缺省走 default_model_id()
  "project_id": 12,                       // optional，登录用户在该项目上迭代
  "base_html": "<!doctype html>...",      // optional，游客迭代基准
  "images": ["data:image/png;base64,..."],// optional，仅 vision 模型生效
  "idempotency_key": "uuid-v4"            // optional，创建幂等
}
```

Response（同步）:
```jsonc
{
  "html": "<!doctype html>...",           // 完整 HTML（新建或迭代后的结果）
  "provider": "DeepSeek Chat",            // 实际使用的模型 label；降级时为 "X → Mock (fallback)"
  "project_id": 12,                       // 登录用户：项目 id；游客：null
  "iterated": true,                       // true=迭代已有项目，false=新建
  "version_id": 42                        // 新版本 id（用于版本列表定位）
}
```

SSE 事件流（`/api/generate/stream`）发送三类事件：
- `event: meta` `data: {project_id, provider, iterated}` — 开头一次性发送
- `event: delta` `data: {text: "..."}` — 增量文本（推理过程 + 代码）
- `event: done` `data: {html, version_id}` — 最终完整 HTML，结束

**`GET /api/models`**
```jsonc
{
  "models": [
    { "id": "openrouter-nemotron-nano-free", "label": "Nemotron 3 Nano 30B",
      "free": true, "transport": "openai", "byok": false, "vision": false }
  ],
  "default": "openrouter-nemotron-nano-free"
}
```
> 只返回 **已配置 key** 的模型 + 常驻 `byok`；`mock` 标 `hidden`，不在下拉出现但作为服务端兜底。
> `default` 永远不指向 `mock`——一旦有真实模型可用，自动指向第一个。

**错误格式**：统一 `{"error": "中文描述"}` + HTTP 状态码：
| 状态码 | 场景 |
|---|---|
| 400 | 参数缺失/格式错误（空 prompt、非法 data URL、图片超限） |
| 401 | 未登录访问需鉴权接口 |
| 404 | 项目不存在 或 不属于当前用户（不泄露存在性） |
| 409 | 邮箱已注册 |
| 429 | 触发限流（如配置） |
| 502 | LLM 调用失败（且未开启/不允许降级） |

### 5.2 公开接口（精选画廊）

无需登录即可访问：
- `GET /api/featured` → 精选作品列表（slug、标题、描述、所用模型）
- `GET /api/featured/{slug}` → 单个作品详情（HTML/CSS/JS 分字段返回）
- `GET /featured-files/{slug}/{name}` → 静态文件（用于代码标签页分别展示 index.html/style.css/app.js）

这部分的存在让**未登录用户也能预览作品质量**，降低体验门槛；打开精选作品时前端会给未登录用户追加一个登录提示气泡，引导注册（见 [static/app.js](static/app.js) 的 `addLoginPrompt`）。

---

## 6. 部署与运维

### 6.1 Render 部署要点

- 平台：Render Web Service（免费档），`render.yaml` 声明 Blueprint：
  - Runtime: Python 3，Build: `pip install -r requirements.txt`
  - Start: `uvicorn app.main:app --host 0.0.0.0 --port $PORT`
  - HealthCheck: `/api/health`
  - Env vars: `sync: false` → 在 Dashboard 手填，不进 git
- Python 版本**锁 3.12.7**（`.python-version`）：Render 默认可能推 Python 3.14，`pydantic-core` 与 `psycopg[binary]` 无 cp314 wheel，会触发 Rust 编译并在只读文件系统失败。锁 3.12 直接使用预编译 wheel，冷启动更快、更稳
- 持久化：Dashboard 配 `DATABASE_URL`=Neon 连接串；不配则回退到容器内 SQLite，重新部署丢数据
- 保活：[.github/workflows/keep-alive.yml](.github/workflows/keep-alive.yml) 每 10 分钟 GET `/api/health`，缓解免费实例 15 分钟无流量休眠
- 冷启动预期：首次访问 ~30–60s 唤醒，后续正常响应

### 6.2 可观测性与健康

- `GET /api/health` 返回 `{"status":"ok","app":"Atoms Demo","default_model":"..."}`，既给 Render 健康检查用，也能一眼看出当前默认模型是什么
- 前端未引入复杂监控（免费档不需要），后端用 Python `logging` 模块记录关键错误（LLM 调用失败、DB 异常），Render 日志面板可直接看

### 6.3 安全清单

- [x] API keys 与 `DATABASE_URL` 只存在环境变量，`.env` 在 `.gitignore`
- [x] 密码 PBKDF2-SHA256 + 每用户独立 salt + 200k 轮次
- [x] Session token 32 字节 `secrets.token_urlsafe`，httponly + SameSite=Lax + HTTPS 下 Secure
- [x] 所有 project/version 查询带 `user_id` 过滤，越权→404
- [x] 生成 HTML 沙箱 iframe 渲染，禁同源/顶层导航/弹窗
- [x] 图片输入做 data URL 格式白名单、张数/大小限制、base64 合法性校验
- [x] 模型 key 永远不传到浏览器，`/api/models` 只返回 id/label/能力标签

---

## 7. 测试策略

### 7.1 后端 pytest 套件

纯离线：强制走 mock 模型 + 临时 SQLite 文件（`tmp_path`），不碰 Neon、不发起真实 LLM 网络请求。

| 测试文件 | 覆盖点 |
|---|---|
| `tests/test_auth.py` | 注册/登录/登出、错误邮箱格式、短密码、重复邮箱、错误密码、`/me` 会话状态 |
| `tests/test_generate.py` | prompt 必填、游客生成不持久化、登录用户创建持久化、原地迭代不重复建项、SSE 流式 |
| `tests/test_ownership.py` | 用户 A 不能读/迭代/列版本/回滚用户 B 的项目（404） |
| `tests/test_versions.py` | 版本随 create+iterate 增长、快照 HTML 可取回、回滚非破坏性（追加新版本） |
| `tests/test_idempotency.py` | 同 key 重复请求→同一项目；不同 key→不同项目；无 key→正常；key 按 user_id 隔离 |
| `tests/test_images.py` | `/api/models` 暴露 vision 标签、data URL 清洗（格式/张数/大小）、OpenAI/Anthropic 消息构造、非 vision 模型丢弃图片 |

### 7.2 前端 node --test 零依赖套件

直接 `node --test tests/js/`，**不需要 jsdom、不需要 package.json、不需要 npm install**——用 Node 内置 `vm` 模块把真实 [static/app.js](static/app.js) 源码在最小 DOM 桩里跑起来，断言纯逻辑函数。

| 测试文件 | 覆盖点 |
|---|---|
| `tests/js/image-upload.test.mjs` | `stageImages` MIME 过滤、`MAX_IMAGES` 上限、超张数/读取错误处理、`syncAttachButton` vision 门控、`composeBody` 按 vision 决定是否携带 images |
| `tests/js/voice.test.mjs` | `setupVoice` 在不支持时隐藏麦克风、识别语言跟随 i18n、结果写回 textarea、`aborted`/`no-speech` 错误静默处理 |
| `tests/js/preview.test.mjs` | `showPreview` 用 `requestAnimationFrame` 延迟切 tab（修复 iframe 空白问题） |
| `tests/js/login-prompt.test.mjs` | guest 打开 featured 作品调用 `addLoginPrompt`、登录用户不调用、内联链接 href 为 `/login` |

---

## 8. 验收指引（评审快速走查）

建议按此顺序体验 https://atoms-demo-lted.onrender.com ，3–5 分钟可覆盖核心闭环：

1. **首屏检查**：默认中文；右上角有 `🌐 中`（语言切换）、模型下拉、"登录/注册"入口；左侧有"精选作品"画廊（无需登录可预览）
2. **中英切换**：点 `🌐 中` → 全站英文、按钮变 `🌐 EN`；刷新后保持
3. **精选作品**：点开"专注番茄钟"或"城市漫游"→ 右侧 iframe 加载示范应用；中间 chat 面板显示"已打开精选作品…"提示；**游客会看到额外的登录提示气泡**，点链接跳登录页
4. **注册/登录**：点右上角"登录/注册" → 独立登录页（tab 切换、密码显隐按钮、友好错误提示）→ 注册后回主页
5. **生成**：输入"一个带开始/暂停的番茄钟，加任务清单" → 点生成 → 右侧 iframe 实时渲染（若走真实模型可看到 SSE 流式输出）；左侧"我的项目"新增一条
6. **迭代（Agent 核心）**：再输入"把按钮改成绿色、加一个完成音效" → **同一应用原地更新**，项目列表不新增重复项
7. **持久化**：退出登录→重新登录→项目仍在；或过段时间再来→数据仍在（Neon Postgres）
8. **版本回滚**：项目详情面板打开版本历史→回滚到较早版本→当前预览回到旧版，历史里新增一条"回滚"记录
9. **导出**：点"下载 HTML"→ 得到可独立运行的单文件 HTML；点"新标签打开"→脱离沙箱真机运行
10. **多模态（加分项）**：切换到有 👁 标识的 vision 模型→上传图片→要求"按这个风格改造"；点麦克风→语音输入（Chrome 效果最佳）

> 首次访问若实例在休眠，需等 ~30–60s 冷启动，属 Render 免费档正常现象。保活 workflow 已尽量缓解。

---

## 9. 已知取舍与未来方向

详见 [SUBMISSION.md §三、四](./SUBMISSION.md)（扩展路线 P0–P3 与规模化演进路径）。核心摘要：
- **有意未做**：移动优先生成约束、付费计费、多文件工程、协作分享、第三方登录——按用户价值/成本比列入 P0–P3 优先级
- **规模化第一瓶颈是代码而非钱**：版本全量快照、无分页、无连接池会在付费升级前先成为瓶颈，需先做代码侧优化
- **mock 模型是架构核心而非临时拐杖**：既是零 key 启动能力、也是错误降级路径、也是测试套件的基础

---

# English

## 1. What it is

Atoms Demo is a mini **AI app builder** inspired by Atoms / v0 / bolt.new.

The user describes a web app in natural language; the backend forwards the request to an LLM, which returns a **self-contained single-file HTML** (inline CSS/JS); the frontend renders it live inside a **sandboxed iframe**. For logged-in users, each generation is persisted as a "project", and follow-up messages in the chat drive the model to **edit the current HTML in place** — turning a one-shot generator into a conversation-style, agentic builder.

**Core loop**: `Describe → Generate → Live preview → Save → Iterate via chat → Roll back versions → Export`.

---

## 2. Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                       Browser (static SPA, no build step)        │
│                                                                  │
│  ┌──────────┐   ┌──────────────┐   ┌──────────────────────────┐  │
│  │ Projects │   │  Chat Panel  │   │ Sandboxed <iframe>       │  │
│  │ (list)    │◄──┤ (msgs/input) │──►│ srcdoc render, sandbox   │  │
│  └──────────┘   └──────┬───────┘   └──────────────────────────┘  │
│                        │ fetch JSON + SSE                        │
└────────────────────────┼─────────────────────────────────────────┘
                         │
┌────────────────────────▼─────────────────────────────────────────┐
│                     FastAPI Backend (app/)                       │
│                                                                  │
│  main.py ── /api/health · /api/models · /api/auth/*              │
│            /api/generate · /api/generate/stream (SSE)            │
│            /api/projects · /api/projects/{id}/versions           │
│            /api/featured/*  (public showcase gallery)            │
│     │                                                            │
│     ├── auth.py  — PBKDF2-HMAC-SHA256 (200k rounds)              │
│     │              httponly + SameSite=Lax cookie sessions       │
│     │              Secure flag adapts via X-Forwarded-Proto      │
│     │                                                            │
│     ├── llm.py + config.py                                       │
│     │     MODEL_REGISTRY (pluggable model table)                 │
│     │     transports: mock · openai-compatible · anthropic       │
│     │     feature flags: vision · free · byok · hidden           │
│     │     error path: LLM_FALLBACK_TO_MOCK → degrades, no 500    │
│     │                                                            │
│     └── db.py ─ dual-backend abstraction, one function surface   │
│            DATABASE_URL set → PostgreSQL (psycopg 3)             │
│            otherwise      → SQLite (stdlib)                      │
│            SQL placeholders ? → %s auto-rewrite;                 │
│            lastrowid ↔ RETURNING id bridging                     │
└──────────────────────────────────────────────────────────┘
                         │
        ┌────────────────┴────────────────┐
        ▼                                 ▼
  PostgreSQL (Neon, prod)           LLM Providers
  survives restarts/redeploys       OpenRouter · DeepSeek · Doubao
                                    Moonshot · OpenAI · Anthropic
                                    (unified OpenAI-compatible transport,
                                     Anthropic adapted separately)
```

**Three swappable seams** keep core code clean while enabling extensibility:

| Seam | Abstraction | Cost of swapping |
|---|---|---|
| ① LLM | `MODEL_REGISTRY` table + transport dispatch | add one config row + one env var |
| ② Database | `db.py` unified function surface + placeholder/id bridging | add a backend implementing the same functions |
| ③ UI language | `i18n.js` dictionary + `data-i18n` attrs + `langchange` event | add a language-pack object |

---

## 3. Key design decisions

### 3.1 LLM layer: registry pattern, not a hard-wired provider

Rather than coding against a single vendor, we maintain a `MODEL_REGISTRY` ([app/config.py](app/config.py)). Each entry declares:
- `transport`: `mock` / `openai` / `anthropic`
- `base_url` + `model`: actual request target
- `key_env`: **which env var holds the key** (keys never reach the browser)
- capability flags: `vision` (image-capable), `free`, `byok` (user-supplied key), `hidden` (hidden in dropdown, server-side fallback only)

The browser sends only a model `id`; the server looks up the entry, reads the corresponding env var, and constructs the request.

**Why this design**:
- Adding a new model (e.g. Gemini) = one config row + one env var — no edits to generate/iterate/message-building logic
- DeepSeek / Doubao / Kimi / OpenRouter / OpenAI are all OpenAI-compatible, **sharing one transport** — zero duplication
- API keys live only on the server; they cannot be sniffed from the browser console

### 3.2 The keyless `mock` model: "run without a key" as a first-class citizen

The `mock` transport requires zero API keys and returns a genuinely interactive sample HTML; in edit mode it appends each change to a visible "change log" so the iterate loop is fully demonstrable **even without a real LLM**.

This unlocks two things:
1. **Deploy first, wire keys later**: Render can ship a fully usable demo on day one without any keys configured; real models can be added later
2. **Graceful degradation**: with `LLM_FALLBACK_TO_MOCK=true`, if a real model fails (bad key / quota / network), the call transparently falls back to mock; the response's `provider` field reads "X → Mock (fallback)" so the user sees a result, not a 500

### 3.3 Create vs. iterate: the server holds the authoritative HTML

`/api/generate` serves two modes:

| Mode | Trigger | Base HTML source | Persistence |
|---|---|---|---|
| **Create** | no `project_id`, no `base_html` | none (built from scratch) | logged-in: insert project + first version; guest: return HTML only |
| **Iterate (logged-in)** | has `project_id` | **server loads from DB scoped by `user_id`+`project_id`** | update projects.html + append version snapshot |
| **Iterate (guest)** | has `base_html`, no `project_id` | trust client-supplied `base_html` | not persisted; return new HTML only |

**Why load the base server-side**:
- **Tamper-proof**: the client cannot forge which project to edit or which HTML to start from — eliminates cross-user tampering entirely
- **No list clutter**: iterations update the same project in place; "My Projects" doesn't grow one row per chat turn
- **Idempotency**: create requests accept an `idempotency_key`; replaying the same key returns the same project (covered by [test_idempotency](tests/))

### 3.4 Persistence: dual backend, one interface

[app/db.py](app/db.py) picks the backend **at import time** based on `DATABASE_URL`:
- set → PostgreSQL (via psycopg 3, `dict_row` factory)
- unset → SQLite (stdlib, `row_factory = sqlite3.Row`)

Both expose the exact same function set (`create_user` / `get_project` / `append_version` / ...); upper layers never branch on backend type. Two bridges handle impedance mismatches:

- **Placeholder rewriting**: SQL is written with `?` placeholders and auto-rewritten to `%s` on Postgres (via the `_placeholders()` helper)
- **INSERT id return**: SQLite uses `cursor.lastrowid`; Postgres uses `INSERT ... RETURNING id`; `_insert_id()` unifies the two

**Why SQLite locally + Postgres in prod**:
- Local zero-config: `git clone && pip install && uvicorn` just works, no local Postgres required
- Prod durability: Render's free-tier disk is ephemeral (wiped on redeploy/sleep), so an external database is mandatory to satisfy the "data persistence" requirement — Neon's free tier offers 500 MB storage + 1 GB RAM, enough for demo scale

### 3.5 Auth: standard library only

- **Password hashing**: `hashlib.pbkdf2_hmac("sha256", password, salt, 200_000)` — stdlib. No bcrypt/argon2 to avoid C extension compilation failures on Render's read-only filesystem
- **Sessions**: `secrets.token_urlsafe(32)` opaque tokens stored in a `sessions` table; delivered via **httponly** cookie with `SameSite=Lax` (CSRF mitigation)
- **Adaptive Secure flag**: local HTTP testing can't use Secure (browser would drop the cookie), but HTTPS in prod must — read `X-Forwarded-Proto` (set by Render's reverse proxy) to detect the real scheme and set the flag dynamically
- **Ownership isolation**: every project/version query carries `WHERE user_id = ?`; accessing another user's project returns 404 (no existence leak)

### 3.6 Preview sandbox: security vs. usability trade-off

Generated HTML renders via `<iframe sandbox="allow-scripts allow-forms allow-modals" srcdoc="...">`.
- **Allowed**: the app's own scripts, form submission, alert/confirm modals — keeps generated apps genuinely interactive
- **Denied**: `allow-same-origin` (no parent DOM/cookie/storage access), `allow-top-navigation` (can't navigate the parent), `allow-popups` (no rogue windows)

When idle, a dark placeholder graphic is shown (matching the app theme) to avoid a jarring white iframe against the dark UI.

### 3.7 i18n: runtime swap + event-driven re-render

[i18n.js](static/i18n.js) holds `zh` / `en` dictionaries and swaps strings on load and on language change via three attributes: `data-i18n` (text), `data-i18n-ph` (placeholder), `data-i18n-title` (tooltip).

- Preference stored in `localStorage`; Chinese is the default
- On toggle, a custom `langchange` event is dispatched; dynamically rendered content (status bar, chat messages, project list, model dropdown labels) listens and re-renders itself — no MutationObserver, predictable performance
- The toggle **shows the current language** (`🌐 中` / `🌐 EN`) rather than a generic "globe" icon, so users always know what language they're in

### 3.8 Multimodal input: images (gated) + voice (zero-cost native)

**Image upload**:
- Encoded as base64 data URLs inside the JSON body (no multipart dependency — keeps the build-less promise)
- **Dual gating**: the frontend **greys out the attach button** based on the selected model's `vision` flag and clears staged images when switching to a non-vision model; the server re-validates `vision` and drops the `images` field for non-vision models (stops stale clients or forged requests)
- **Provider-shaped payloads**: OpenAI-compatible transports get an `image_url` content array; Anthropic gets base64 `source` blocks (see `_build_messages()` in `llm.py`)
- **Sanitization**: only `data:image/(png|jpeg|gif|webp);base64,` accepted; capped by `MAX_IMAGES` count and per-image size; `main.py` validates base64 decodability

**Voice input**:
- Uses the browser's **Web Speech API** (`SpeechRecognition`) directly to transcribe into the textarea on the client side
- **No backend, no cost, no key**; recognition language follows i18n (`zh-CN` / `en-US`)
- When unsupported (limited in Safari/Firefox), the mic button is **hidden**, not shown as a dead control

**Why dual-gate images, client-side voice**:
- Sending images to a text-only model wastes tokens and risks hallucinations — must be guarded on both sides
- Voice is an input aid, not worth introducing Whisper API cost/latency; the native path is good enough

### 3.9 Idempotent create: retries don't fork projects

When creating a new project, the client generates a `idempotency_key` (UUID v4) and sends it with the request; the backend enforces a UNIQUE constraint on `(user_id, idempotency_key)`:
- same key replayed → existing project returned, no duplicate
- different key → new project created
- no key (legacy clients) → normal create, backwards compatible

Network jitter, double-clicks, and SSE reconnects never produce two copies of the same prompt.

### 3.10 Version history: append-only + non-destructive rollback

Every generate/iterate/rollback **appends** a snapshot row to `project_versions` (`id, project_id, prompt, html, provider, created_at`); `projects.html` always points at the "current" version.

Rollback (`/api/projects/{id}/versions/{vid}/restore`) does **not** just move `projects.html` back — it **appends the target snapshot's HTML as a new version**, recording the rollback itself in history. Benefits:
- history is never truncated, full audit trail
- "roll back then edit" doesn't fork
- the version list in the UI can show "restored from v3" style traces

---

## 4. Data model

```
users
┌──────────────────────────────────────────┐
│ id            INTEGER PRIMARY KEY         │
│ email         TEXT UNIQUE NOT NULL        │
│ password_hash TEXT NOT NULL               │   ── PBKDF2-SHA256, 200k rounds
│ created_at    TIMESTAMP NOT NULL          │
└──────────────────────────────────────────┘
    ▲
    │ user_id
sessions
┌──────────────────────────────────────────┐
│ token         TEXT PRIMARY KEY            │   ── secrets.token_urlsafe(32)
│ user_id       INTEGER NOT NULL → users.id │
│ created_at    TIMESTAMP NOT NULL          │
└──────────────────────────────────────────┘
    ▲
    │ user_id  (every query is scoped)
projects
┌──────────────────────────────────────────┐
│ id             INTEGER PRIMARY KEY        │
│ user_id        INTEGER NOT NULL → users.id│
│ title          TEXT                       │   ── auto-derived from prompt, editable
│ prompt         TEXT NOT NULL              │   ── latest instruction (overwritten on iterate)
│ html           TEXT NOT NULL              │   ── currently live HTML
│ provider       TEXT                       │   ── model label used for latest version
│ idempotency_key TEXT UNIQUE(user_id,key)  │   ── create idempotency
│ created_at     TIMESTAMP NOT NULL         │
│ updated_at     TIMESTAMP NOT NULL         │
└──────────────────────────────────────────┘
    │
    │ project_id  (CASCADE DELETE)
    ▼
project_versions
┌──────────────────────────────────────────┐
│ id            INTEGER PRIMARY KEY         │
│ project_id    INTEGER NOT NULL            │
│ prompt        TEXT NOT NULL               │   ── instruction for this version (create/iterate/restore)
│ html          TEXT NOT NULL               │   ── full HTML snapshot at this version
│ provider      TEXT                        │
│ kind          TEXT NOT NULL DEFAULT 'gen' │   ── 'gen' | 'iter' | 'restore'
│ restored_from INTEGER                      │   ── for kind='restore', points at source vid
│ created_at    TIMESTAMP NOT NULL          │
└──────────────────────────────────────────┘
```

**Key indexes**:
- `projects(user_id, created_at DESC)` — list query
- `project_versions(project_id, created_at DESC)` — version list
- `projects(user_id, idempotency_key) UNIQUE` — idempotency constraint
- `sessions(token)` — session lookup (token is the PK)

---

## 5. API contract

### 5.1 Core endpoints

**`POST /api/generate`** (blocking) / **`POST /api/generate/stream`** (SSE)

Request:
```jsonc
{
  "prompt": "a pomodoro timer with start/pause", // required
  "model": "deepseek-chat",                     // optional, defaults via default_model_id()
  "project_id": 12,                             // optional, logged-in user iterates in place
  "base_html": "<!doctype html>...",            // optional, guest iteration base
  "images": ["data:image/png;base64,..."],      // optional, vision models only
  "idempotency_key": "uuid-v4"                  // optional, create idempotency
}
```

Response (blocking):
```jsonc
{
  "html": "<!doctype html>...",           // full HTML (newly created or iterated)
  "provider": "DeepSeek Chat",            // actual model label; on fallback: "X → Mock (fallback)"
  "project_id": 12,                       // logged-in: project id; guest: null
  "iterated": true,                       // true = iterated, false = newly created
  "version_id": 42                        // new version id (for version-list anchoring)
}
```

SSE stream (`/api/generate/stream`) emits three event types:
- `event: meta` `data: {project_id, provider, iterated}` — sent once at the start
- `event: delta` `data: {text: "..."}` — incremental tokens (reasoning + code)
- `event: done` `data: {html, version_id}` — final HTML, terminates the stream

**`GET /api/models`**
```jsonc
{
  "models": [
    { "id": "openrouter-nemotron-nano-free", "label": "Nemotron 3 Nano 30B",
      "free": true, "transport": "openai", "byok": false, "vision": false }
  ],
  "default": "openrouter-nemotron-nano-free"
}
```
> Only models with a **configured key** are returned, plus the always-on `byok`; `mock` is flagged `hidden` — kept as server-side fallback but never shown in the dropdown.
> `default` never points at `mock` — once a real model is available, the first one becomes the default.

**Error shape**: unified `{"error": "..."}` with appropriate HTTP status:

| Status | Scenario |
|---|---|
| 400 | missing/malformed input (empty prompt, illegal data URL, image cap exceeded) |
| 401 | unauthenticated access to an auth-gated endpoint |
| 404 | project missing or not owned (no existence leak) |
| 409 | email already registered |
| 429 | rate limited (if configured) |
| 502 | LLM call failed (and fallback disabled/disallowed) |

### 5.2 Public endpoints (showcase gallery)

Accessible without login:
- `GET /api/featured` → list of featured entries (slug, title, description, provider)
- `GET /api/featured/{slug}` → single entry detail (HTML/CSS/JS in separate fields)
- `GET /featured-files/{slug}/{name}` → static file (used by the Code tab to render index.html/style.css/app.js separately)

These let guests preview the quality of generated output without signing up. When a guest opens a featured entry, the frontend appends a login-prompt assistant bubble nudging them to register (see `addLoginPrompt` in [static/app.js](static/app.js)).

---

## 6. Deployment & ops

### 6.1 Render deployment notes

- Platform: Render Web Service (free tier), declared by `render.yaml` as a Blueprint:
  - Runtime: Python 3, Build: `pip install -r requirements.txt`
  - Start: `uvicorn app.main:app --host 0.0.0.0 --port $PORT`
  - HealthCheck: `/api/health`
  - Env vars: `sync: false` → filled in the Dashboard, never committed
- Python **pinned to 3.12.7** (`.python-version`): Render may default to Python 3.14 for which `pydantic-core` and `psycopg[binary]` ship no cp314 wheels, triggering Rust compilation that fails on the read-only filesystem. Pinning 3.12 uses prebuilt wheels — faster cold start, fewer failures
- Persistence: set `DATABASE_URL`=Neon string in the Dashboard; without it, falls back to in-container SQLite and loses data on redeploy
- Keep-alive: [.github/workflows/keep-alive.yml](.github/workflows/keep-alive.yml) GETs `/api/health` every 10 minutes to mitigate the free-tier's 15-minute idle sleep
- Cold-start expectation: ~30–60s on first hit; normal response times after that

### 6.2 Observability & health

- `GET /api/health` returns `{"status":"ok","app":"Atoms Demo","default_model":"..."}` — serves both Render's health check and at-a-glance verification of which model is default
- No heavy monitoring stack (overkill for the free tier); the backend uses Python `logging` for key errors (LLM failures, DB errors), viewable in the Render logs panel

### 6.3 Security checklist

- [x] API keys and `DATABASE_URL` only in env vars; `.env` is in `.gitignore`
- [x] Passwords: PBKDF2-SHA256 + per-user salt + 200k rounds
- [x] Session tokens: 32-byte `secrets.token_urlsafe`, httponly + SameSite=Lax + Secure on HTTPS
- [x] All project/version queries scoped by `user_id`; cross-user access → 404
- [x] Generated HTML rendered in a sandboxed iframe (no same-origin, no top-navigation, no popups)
- [x] Image inputs validated (data URL whitelist, count/size caps, base64 decodability)
- [x] Model keys never reach the browser; `/api/models` returns only ids/labels/capability flags

---

## 7. Testing strategy

### 7.1 Backend pytest suite

Fully offline: forced to the `mock` model + per-test temp SQLite file (`tmp_path`); no Neon access, no real LLM network calls.

| Test file | What's covered |
|---|---|
| `tests/test_auth.py` | register/login/logout, bad email format, short password, duplicate email, wrong password, `/me` session state |
| `tests/test_generate.py` | prompt required, guest generate not persisted, logged-in create persists, in-place iterate does not duplicate, SSE streaming |
| `tests/test_ownership.py` | user A cannot read/iterate/list-versions/restore user B's project (404) |
| `tests/test_versions.py` | versions grow with create+iterate, snapshot HTML retrievable, rollback is non-destructive (appends new version) |
| `tests/test_idempotency.py` | same key → same project; different keys → distinct; keyless → legacy path; key scoped per user |
| `tests/test_images.py` | `/api/models` exposes vision flag, data URL sanitization (format/count/size), OpenAI/Anthropic message shaping, non-vision models drop images |

### 7.2 Frontend node --test zero-dependency suite

Run with `node --test tests/js/` — **no jsdom, no package.json, no npm install needed**. Node's built-in `vm` module loads the real [static/app.js](static/app.js) source against a minimal DOM shim and asserts on pure logic functions.

| Test file | What's covered |
|---|---|
| `tests/js/image-upload.test.mjs` | `stageImages` MIME filter, `MAX_IMAGES` cap, oversize/read-error handling, `syncAttachButton` vision gating, `composeBody` attaches images only for vision models |
| `tests/js/voice.test.mjs` | `setupVoice` hides mic when unsupported, recognition language follows i18n, result appends to textarea, `aborted`/`no-speech` errors silently handled |
| `tests/js/preview.test.mjs` | `showPreview` delays tab reveal via `requestAnimationFrame` (fixes the stale/blank iframe bug) |
| `tests/js/login-prompt.test.mjs` | guest opening a featured entry calls `addLoginPrompt`; logged-in user does not; inline link href is `/login` |

---

## 8. How to review (quick walkthrough)

Suggested path through https://atoms-demo-lted.onrender.com — covers the core loop in 3–5 minutes:

1. **Landing**: Chinese by default; top-right shows `🌐 中` (language), model dropdown, "Login/Register"; left rail has a "Featured" gallery (preview without login)
2. **Language toggle**: click `🌐 中` → whole app turns English, button becomes `🌐 EN`; preference persists across reloads
3. **Featured gallery**: click "Focus Pomodoro" or "City Explorer" → iframe loads the demo app; chat panel shows a "featured loaded" message; **guests see an additional login-prompt bubble** with an inline link to /login
4. **Register/login**: click "Login/Register" → dedicated page (tabs, password reveal, friendly errors) → land back on the main page
5. **Generate**: type "a pomodoro timer with start/pause and a task list" → Generate → iframe renders live (real models produce streaming SSE output); "My Projects" gets a new item
6. **Iterate (the agent bit)**: type "make the button green and add a chime on completion" → updates **the same app in place**, no new list entry
7. **Persistence**: log out → log back in → projects are still there; return later → data survives (Neon Postgres)
8. **Version rollback**: open version history → roll back to an earlier snapshot → preview reverts, history gains a new "restore" entry
9. **Export**: click "Download HTML" → a standalone single-file HTML; click "Open in new tab" → runs outside the sandbox
10. **Multimodal (bonus)**: switch to a model marked 👁 (vision) → attach an image → ask to "restyle this to match the image"; click the mic → voice input (works best in Chrome)

> On the first hit, if the instance is asleep, expect ~30–60s cold start — normal for Render's free tier. The keep-alive workflow mitigates this as much as possible.

---

## 9. Known trade-offs & future work

See [SUBMISSION.md §III–IV](./SUBMISSION.md) for the full P0–P3 roadmap and scaling/cost evolution path. Summary:
- **Intentionally not built**: mobile-first generation constraint, billing/payments, multi-file projects, collaboration/sharing, third-party login — queued as P0–P3 by value/cost ratio
- **The first scaling bottleneck is code, not cash**: full-HTML version snapshots, unpaginated lists, and per-request connections will become bottlenecks before any paid-tier upgrade is needed
- **The `mock` model is a core architectural primitive**, not a temporary crutch: it enables zero-key startup, graceful error degradation, and the offline test suite
