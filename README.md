# Atoms Demo

> 🌐 **中文版说明见 [README.zh-CN.md](./README.zh-CN.md)** · Architecture & design notes: [DESIGN.md](./DESIGN.md)

A mini **AI app builder**: describe an app in plain language, an LLM generates a
self-contained web app, and it renders live in a sandboxed preview — then you can
keep chatting to **iterate on it in place**. Inspired by Atoms / v0 / bolt.new.

- **Live demo:** https://atoms-demo-lted.onrender.com
- **Source:** https://github.com/eviessun/atoms-demo

The whole pipeline (type request → generate → live preview → save → iterate) is
real and interactive, data is **persisted in a cloud database**, and it runs out
of the box with **no API key** via a keyless `mock` model.

---

## Highlights

| Requirement | How it's met |
| --- | --- |
| **Real interaction (not static)** | Generate an app, then refine it by chatting ("make the button green"); the model edits the current HTML in place |
| **Data persistence** | Accounts + generated projects stored in **PostgreSQL (Neon)**; survives restarts/redeploys. Auto-falls back to SQLite locally |
| **Public link** | Deployed on Render (free): https://atoms-demo-lted.onrender.com |
| **Multi-model, key-safe** | Trae-style model dropdown; API keys stay on the server, the browser only sends a model id |
| **Bilingual UI** | One-click 中 / EN toggle across the whole app, preference remembered |
| **Runs with zero keys** | Keyless `mock` model + graceful fallback so a live demo never hard-errors |

---

## Architecture

Three-panel single-page frontend (no build step) talks to a FastAPI backend,
which owns auth, the LLM adapter, and a dual-backend datastore. The same
generate path serves a **blocking** endpoint and an **SSE streaming** twin.

```mermaid
flowchart LR
    subgraph Browser["Browser — static SPA (no build)"]
        UI["index.html · app.js<br/>projects · chat · sandboxed &lt;iframe&gt; preview"]
    end
    subgraph Server["FastAPI (app/)"]
        API["main.py<br/>auth · generate · projects · versions"]
        AUTH["auth.py<br/>PBKDF2 + cookie sessions"]
        LLM["llm.py + config.py<br/>model registry · mock / OpenAI / Anthropic"]
        API --- AUTH
        API --- LLM
    end
    subgraph Data["Persistence (db.py)"]
        PG[("PostgreSQL — Neon<br/>(prod)")]
        SQLITE[("SQLite<br/>(local)")]
    end
    Providers["LLM providers<br/>OpenRouter · DeepSeek · Doubao · …"]

    UI -- "POST /api/generate(/stream)" --> API
    UI -- "cookie session" --> AUTH
    LLM -. "OpenAI-compatible / Anthropic" .-> Providers
    API -- "DATABASE_URL set?" --> PG
    API -- "else" --> SQLITE
```

**Request flow — generate → persist → iterate:**

1. Browser POSTs a prompt to `/api/generate` (or `/api/generate/stream` for
   live reasoning + code). A per-create **idempotency key** rides along so a
   retry/replay can't fork a duplicate project.
2. `main.py` validates + resolves ownership, `llm.py` calls the selected model
   (keys stay server-side; `mock` needs none).
3. The result is saved via `db.py` as a project **plus an append-only version
   snapshot**; the response carries the `project_id`.
4. Follow-up messages iterate **in place** on that `project_id` — the server
   loads the authoritative current HTML, so the client can't forge the base.

---

## Tech stack

- **Backend:** FastAPI (Python 3.12), served by uvicorn
- **Frontend:** static HTML/CSS/JS (no build step) — three panels: saved projects · chat · live `<iframe>` preview
- **Persistence:** `psycopg` 3 → PostgreSQL when `DATABASE_URL` is set; stdlib `sqlite3` otherwise
- **Auth:** email + password, PBKDF2-HMAC-SHA256 hashing (stdlib), opaque session token in an httponly cookie
- **LLM layer:** a swappable adapter (`app/llm.py`) driven by a model registry (`app/config.py`); transports: `mock` · OpenAI-compatible · Anthropic
- **Deploy:** Render (web service, free tier) + a GitHub Actions keep-alive ping

No compiled dependencies beyond `pydantic-core` and `psycopg[binary]` (both ship
wheels for Python 3.12 — hence the pinned `.python-version`).

---

## Project layout

```
atoms-demo/
├─ app/
│  ├─ main.py       # FastAPI app: health, models, auth, generate, projects; serves frontend
│  ├─ config.py     # Settings + MODEL_REGISTRY (the selectable models & their key env vars)
│  ├─ llm.py        # swappable LLM adapter: mock / openai-compatible / anthropic; create + edit modes
│  ├─ db.py         # dual-backend persistence: Postgres (DATABASE_URL) or SQLite
│  └─ auth.py       # password hashing + cookie sessions (stdlib only)
├─ static/
│  ├─ index.html    # main app (projects · chat · preview), i18n-tagged
│  ├─ login.html    # dedicated login/register page (tabbed, password reveal)
│  ├─ app.js        # main UI logic (generate, iterate, projects, model picker)
│  ├─ login.js      # login page logic
│  ├─ i18n.js       # zh/en dictionary + runtime translation (shared)
│  └─ style.css / login.css
├─ scripts/
│  └─ test_db_backend.py   # end-to-end DB backend check (users/sessions/projects)
├─ tests/           # pytest suite: auth · generate · ownership · versions · idempotency
├─ .github/workflows/keep-alive.yml   # pings /api/health so the free instance stays awake
├─ render.yaml      # Render blueprint (Python 3.12, env vars, health check)
├─ .python-version  # 3.12.7 — avoids Python 3.14 wheel/compile issues on Render
├─ requirements.txt
├─ requirements-dev.txt   # + pytest, for running the test suite
├─ .env.example     # single-model quickstart
└─ .env.multi-model.example   # all providers at once
```

---

## Run locally

```bash
python3.12 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8123
```

Open http://127.0.0.1:8123 . With no `.env`, it uses the keyless `mock` model and
SQLite, so you can register, generate, preview, and iterate immediately — no key,
no database setup.

---

## Tests

A `pytest` suite covers the backend end to end, fully offline (the `mock` model,
a throwaway SQLite file per test — it never touches Neon or the network):

```bash
pip install -r requirements-dev.txt
pytest
```

| Area | What's covered |
| --- | --- |
| **Auth** | register/login/logout, bad email & short password, duplicate email, wrong password, session `me` |
| **Generate** | prompt required, guest gets HTML but nothing persisted, logged-in create persists, iterate-in-place |
| **Ownership** | a user can't read/iterate/list-versions of another user's project (404, no existence leak) |
| **Versions** | history grows on create+iterate, snapshot HTML fetch, **non-destructive rollback** (restore appends) |
| **Idempotency** | same key → one project; different keys → distinct; keyless → legacy; key scoped per user |

---

## Choosing a model (Trae-style dropdown)

Instead of one hard-wired provider, the app keeps a **registry** of selectable
models (`MODEL_REGISTRY` in [app/config.py](app/config.py)). The UI shows a
dropdown; **a model only appears if its API key env var is set** (plus the
always-on BYOK entry). The keyless `mock` is `hidden` — kept as a server-side
fallback but never shown as a choice. API keys never leave the server — the
browser sends only a model `id` (e.g. `deepseek-chat`), and the key for that id
is read from the environment on the server.

Copy `.env.example` (or `.env.multi-model.example`) to `.env` and fill in only the
providers you want:

```bash
# Free / low-cost, all OpenAI-compatible:
DEEPSEEK_API_KEY=sk-...           # ids: deepseek-chat, deepseek-reasoner
OPENROUTER_API_KEY=sk-or-...      # ids: openrouter-nemotron-free, openrouter-gptoss-free ($0)
MOONSHOT_API_KEY=sk-...           # id: kimi
DOUBAO_API_KEY=...                # id: doubao (Volcano Ark)

# Generic OpenAI-compatible (OpenAI / Groq / local / custom):
OPENAI_API_KEY=sk-...
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL=gpt-4o-mini

# Premium:
ANTHROPIC_API_KEY=sk-ant-...      # id: anthropic

# Which model is selected on first load (optional):
DEFAULT_MODEL_ID=mock
# If the chosen model errors (bad key/quota/network), degrade to mock instead of failing:
LLM_FALLBACK_TO_MOCK=true
```

**Adding a provider** = add one row to `MODEL_REGISTRY` + set its key env var.
Nothing else changes — DeepSeek, Doubao, Kimi, OpenRouter and OpenAI all reuse the
one OpenAI-compatible transport.

---

## Persistence: Postgres or SQLite

[app/db.py](app/db.py) picks the backend at startup from the environment:

- `DATABASE_URL` set → **PostgreSQL** (via `psycopg` 3). Used on Render with a free
  **Neon** database so data survives redeploys/restarts.
- `DATABASE_URL` unset → **SQLite** file (zero-config local dev).

Both backends expose the same functions, so the rest of the app never knows which
is active. Three tables: `users`, `sessions`, `projects`.

> ⚠️ On Render's free tier the container disk is ephemeral, so SQLite data is wiped
> on every redeploy. Set `DATABASE_URL` (Neon) in the Render dashboard for durable
> storage.

---

## Deploy to Render (public link)

This repo ships `render.yaml`, so it deploys as a web service on the free tier.

1. Push the repo to GitHub.
2. Render → **New +** → **Web Service** (or **Blueprint** to read `render.yaml`) → connect the repo.
   - Runtime: Python 3.12 · Build: `pip install -r requirements.txt`
   - Start: `uvicorn app.main:app --host 0.0.0.0 --port $PORT` · Health: `/api/health`
3. In **Environment**, add the secrets you need (Render keeps them out of git):
   - `DATABASE_URL` — your Neon connection string (durable persistence)
   - any model API keys, e.g. `OPENROUTER_API_KEY`
   - optionally `DEFAULT_MODEL_ID` (e.g. `openrouter-nemotron-free`)
4. Deploy → you get a public URL like `https://atoms-demo-lted.onrender.com`.

> Render's free instance sleeps after ~15 min idle; the first request then takes
> ~30–60s to wake. `.github/workflows/keep-alive.yml` pings `/api/health` every
> 10 minutes to keep it warm during the review window.

---

## API

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/health` | Liveness + default model id |
| GET | `/api/models` | Selectable models (ids + labels only — never keys) |
| POST | `/api/auth/register` | email + password → sets session cookie |
| POST | `/api/auth/login` | login → sets session cookie |
| POST | `/api/auth/logout` | clears session |
| GET | `/api/auth/me` | current user (or null) |
| POST | `/api/generate` | build a new app, or iterate on one (`project_id` / `base_html`); create dedupes on optional `idempotency_key` |
| GET | `/api/projects` | current user's saved apps |
| GET | `/api/projects/{id}` | one saved app (owner-scoped) |
| GET | `/api/projects/{id}/versions` | a project's version snapshots (newest first, owner-scoped) |
| GET | `/api/projects/{id}/versions/{vid}` | one snapshot's full HTML (for preview) |
| POST | `/api/projects/{id}/versions/{vid}/restore` | roll back to a snapshot (non-destructive — appended as a new version) |
| GET | `/` , `/login` | frontend pages |

See [DESIGN.md](./DESIGN.md) for request/response shapes and design rationale.

---

## Roadmap

- [x] Runnable skeleton — chat UI + mock generate + live preview
- [x] Auth (register/login/logout) + persistence + "My Projects"
- [x] Dedicated login page + one-click 中/EN i18n
- [x] Dual DB backend — Neon Postgres in prod, SQLite locally
- [x] Iterate loop — refine a generated app via follow-up messages (agent behavior)
- [x] Multi-model dropdown (key-safe), free-model seam + graceful fallback
- [x] Streaming generation (SSE — live reasoning + code as it's written)
- [x] Version history per project + non-destructive rollback
- [x] Export the generated app — download `index.html`, copy source, open in a new tab
- [x] Server-side idempotent create — a retry/replay can't fork a duplicate project
- [x] pytest suite — auth · generate · ownership · versions · idempotency (offline)

## Security notes

- API keys and `DATABASE_URL` live only in the environment (`.env` is gitignored;
  Render keeps secrets in its dashboard) — never committed.
- Passwords hashed with PBKDF2-HMAC-SHA256 (200k rounds); sessions are random
  tokens in httponly + `SameSite=Lax` cookies (Secure when served over HTTPS).
- Project access is **owner-scoped**: every project query filters by `user_id`, so
  you can only read/edit your own apps.
- Generated apps render in a **sandboxed iframe** (`allow-scripts allow-forms
  allow-modals`) — no same-origin access.
