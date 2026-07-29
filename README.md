# Atoms Demo

A mini AI-app-builder: describe an app in natural language, an LLM generates a
self-contained web app, and it renders live in a sandboxed preview — inspired by
Atoms / v0 / bolt.new.

This is **Step 1: the runnable skeleton**. The full pipeline
(type request → generate → live preview) already works using a keyless `mock`
provider, so the app runs and deploys before any LLM key is wired in.

## Stack

- **Backend:** FastAPI (Python) — serves the frontend and the `/api/generate` endpoint
- **Frontend:** static HTML/CSS/JS — split view: chat panel (left) + live `<iframe>` preview (right)
- **LLM layer:** swappable adapter (`app/llm.py`) — `mock` | `openai` | `anthropic` | `atoms`

## Project layout

```
atoms-demo/
├─ app/
│  ├─ main.py       # FastAPI app: /api/health, /api/generate, serves frontend
│  ├─ llm.py        # swappable LLM adapter (mock/openai/anthropic/atoms)
│  └─ config.py     # env-based settings
├─ static/          # index.html, style.css, app.js (chat UI + iframe preview)
├─ requirements.txt
└─ .env.example     # copy to .env when adding a real LLM key
```

## Run locally

```bash
python3.12 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8123
```

Open http://127.0.0.1:8123 . With no `.env` it uses `LLM_PROVIDER=mock`, so you can
type a request, hit Generate, and see a demo app render in the preview — no key needed.

## Wiring a real LLM (later step)

Copy `.env.example` to `.env` and set one provider:

```bash
LLM_PROVIDER=openai            # or anthropic / atoms
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o-mini
```

Only `app/llm.py` knows about providers — switching sources touches nothing else.
The Atoms provider is stubbed and gets filled in once its endpoint/format is known.

## Deploy (public link)

Target platforms: **Render** or **Hugging Face Spaces** (both free, both give a public URL).
Start command:

```bash
uvicorn app.main:app --host 0.0.0.0 --port $PORT
```

## Roadmap

- [x] Step 1 — runnable skeleton (chat UI + mock generate + live preview)
- [ ] Step 2 — auth (register/login) + persistence (projects/versions)
- [ ] Step 3 — real LLM generation (streaming)
- [ ] Step 4 — project list + reload saved apps
- [ ] Step 5 — extension: iterative edits ("make the button blue")
- [ ] Step 6 — polish + final deploy
