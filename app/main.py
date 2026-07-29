"""Atoms Demo — FastAPI entry point.

Serves the frontend and exposes the API:
  - /api/health                 liveness + which LLM provider is active
  - /api/auth/register|login|logout|me   email+password auth (cookie session)
  - /api/generate               generate an app; auto-saved for logged-in users
  - /api/projects               list the current user's saved apps
  - /api/projects/{id}          fetch one saved app (with its HTML)

Generation works with no key via the `mock` provider, so the whole pipeline
(type request -> generate -> preview -> persist) is testable end-to-end.
"""
import json
import re
from pathlib import Path

from fastapi import FastAPI, Request, Response
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import auth, db
from .config import BYOK_PRESETS, available_models, build_byok_spec, settings
from .llm import generate_app_html, stream_app_html

BASE_DIR = Path(__file__).resolve().parent.parent
STATIC_DIR = BASE_DIR / "static"

app = FastAPI(title=settings.APP_NAME)

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


@app.on_event("startup")
def _startup() -> None:
    db.init_db()


# --- schemas -------------------------------------------------------------

class GenerateRequest(BaseModel):
    prompt: str
    # Which model to use (id from /api/models). Absent => server default model.
    model: str | None = None
    # BYOK (Bring Your Own Key): when model == "byok", the client sends its own
    # credentials here. They are used for THIS request only — never stored, never
    # written to the environment, never logged.
    byok_key: str | None = None
    byok_model: str | None = None
    byok_base_url: str | None = None
    byok_transport: str | None = None  # "openai" (default) | "anthropic"
    # Iterate loop (all optional; absent => build a brand-new app):
    #  - project_id: modify this saved project in place (logged-in; server holds
    #    the authoritative current HTML, so the client can't forge the base).
    #  - base_html: for guests (no saved project) — the current app HTML to edit.
    project_id: int | None = None
    base_html: str | None = None


class AuthRequest(BaseModel):
    email: str
    password: str


# --- health + models -----------------------------------------------------

@app.get("/api/health")
def health():
    return {
        "status": "ok",
        "app": settings.APP_NAME,
        "default_model": settings.default_model_id(),
    }


@app.get("/api/models")
def models():
    """List the models the UI may offer (Trae-style dropdown).

    Only models whose API key env var is configured are returned (plus keyless
    mock and the always-on BYOK entry). API keys themselves are NEVER included —
    the client only gets ids and labels and sends an id back on /api/generate."""
    return {
        "models": [
            {"id": m.id, "label": m.label, "free": m.free,
             "transport": m.transport, "byok": m.byok}
            for m in available_models()
        ],
        "default": settings.default_model_id(),
    }


@app.get("/api/byok/presets")
def byok_presets():
    """Provider presets for the BYOK dialog (base URL + default model + docs
    link). Contains NO secrets — just hints so the user only pastes a key."""
    return {"presets": BYOK_PRESETS}


# --- auth ----------------------------------------------------------------

def _is_secure(request: Request) -> bool:
    """Whether the original client request was HTTPS. Render (and most PaaS)
    terminate TLS at a proxy and forward the real scheme in X-Forwarded-Proto,
    so we trust that first and fall back to the direct scheme. This lets the
    Secure cookie flag be correct in prod while still working over local HTTP."""
    proto = request.headers.get("x-forwarded-proto", "").split(",")[0].strip()
    return (proto or request.url.scheme) == "https"


def _set_session_cookie(response: Response, token: str, secure: bool) -> None:
    response.set_cookie(
        auth.SESSION_COOKIE, token,
        httponly=True, samesite="lax", secure=secure, max_age=60 * 60 * 24 * 30,
    )


@app.post("/api/auth/register")
def register(req: AuthRequest, request: Request, response: Response):
    email = req.email.strip().lower()
    if not EMAIL_RE.match(email):
        return JSONResponse(status_code=400, content={"error": "invalid email"})
    if len(req.password) < 6:
        return JSONResponse(status_code=400, content={"error": "password must be at least 6 chars"})
    if db.get_user_by_email(email) is not None:
        return JSONResponse(status_code=409, content={"error": "email already registered"})
    user_id = db.create_user(email, auth.hash_password(req.password))
    token = auth.new_session_token()
    db.create_session(token, user_id)
    _set_session_cookie(response, token, _is_secure(request))
    return {"id": user_id, "email": email}


@app.post("/api/auth/login")
def login(req: AuthRequest, request: Request, response: Response):
    email = req.email.strip().lower()
    row = db.get_user_by_email(email)
    if row is None or not auth.verify_password(req.password, row["password_hash"]):
        return JSONResponse(status_code=401, content={"error": "invalid email or password"})
    token = auth.new_session_token()
    db.create_session(token, row["id"])
    _set_session_cookie(response, token, _is_secure(request))
    return {"id": row["id"], "email": email}


@app.post("/api/auth/logout")
def logout(request: Request, response: Response):
    token = request.cookies.get(auth.SESSION_COOKIE)
    if token:
        db.delete_session(token)
    response.delete_cookie(auth.SESSION_COOKIE)
    return {"ok": True}


@app.get("/api/auth/me")
def me(request: Request):
    return {"user": auth.current_user(request)}


# --- generation ----------------------------------------------------------

class _Resolved:
    """Validated inputs for a generation request, shared by the blocking and
    streaming endpoints. `error` is a JSONResponse to return immediately; when
    it's None the other fields are ready to feed the model + persistence."""

    __slots__ = ("error", "prompt", "user", "base_html", "target_project", "byok_spec")

    def __init__(self, error=None, prompt="", user=None, base_html=None,
                 target_project=None, byok_spec=None):
        self.error = error
        self.prompt = prompt
        self.user = user
        self.base_html = base_html
        self.target_project = target_project
        self.byok_spec = byok_spec


def _resolve_generate(req: "GenerateRequest", request: Request) -> _Resolved:
    """Validate a generate request and resolve the base HTML (with ownership)
    and any BYOK spec. Identical rules for /api/generate and its streaming twin."""
    prompt = (req.prompt or "").strip()
    if not prompt:
        return _Resolved(error=JSONResponse(status_code=400, content={"error": "prompt is required"}))

    user = auth.current_user(request)

    # Resolve the base HTML to edit (if any), enforcing ownership for project_id.
    base_html = None
    target_project = None
    if req.project_id is not None:
        if user is None:
            return _Resolved(error=JSONResponse(status_code=401, content={"error": "login required"}))
        target_project = db.get_project(user["id"], req.project_id)
        if target_project is None:
            return _Resolved(error=JSONResponse(status_code=404, content={"error": "project not found"}))
        base_html = target_project["html"]
    elif req.base_html:
        base_html = req.base_html

    # BYOK: build a transient spec from the request's own credentials. The key
    # lives only for this call — it's never stored, logged, or persisted.
    byok_spec = None
    if req.model == "byok":
        key = (req.byok_key or "").strip()
        model_name = (req.byok_model or "").strip()
        if not key:
            return _Resolved(error=JSONResponse(status_code=400, content={"error": "自备 Key 不能为空"}))
        if not model_name:
            return _Resolved(error=JSONResponse(status_code=400, content={"error": "请填写模型名称（model）"}))
        byok_spec = build_byok_spec(
            api_key=key,
            model=model_name,
            base_url=req.byok_base_url or "",
            transport=req.byok_transport or "openai",
        )
        if byok_spec.transport == "openai" and not byok_spec.base_url:
            return _Resolved(error=JSONResponse(status_code=400, content={"error": "请填写 API 地址（base URL）"}))

    return _Resolved(prompt=prompt, user=user, base_html=base_html,
                     target_project=target_project, byok_spec=byok_spec)


def _persist_generation(r: _Resolved, html: str, provider: str) -> tuple[int | None, bool]:
    """Save a finished generation. Updates a saved project in place when
    iterating, else creates a new one for logged-in users. Guests get nothing
    persisted. Returns (project_id, iterated)."""
    if r.target_project is not None:
        db.update_project_html(r.user["id"], r.target_project["id"], r.prompt, html, provider)
        return r.target_project["id"], True
    if r.user is not None:
        return db.create_project(r.user["id"], r.prompt, html, provider), False
    return None, False


@app.post("/api/generate")
def generate(req: GenerateRequest, request: Request):
    """Generate a new app, or iterate on an existing one.

    Create mode (no project_id/base_html): build a fresh app; persist it for
    logged-in users as a new project.

    Iterate mode: feed the current HTML back to the model so it edits in place.
      - Logged-in + project_id: the base is loaded server-side from the user's
        own project (owner-scoped), and the same project is updated in place.
      - Otherwise: use the client-provided base_html (guest flow).
    """
    r = _resolve_generate(req, request)
    if r.error is not None:
        return r.error

    try:
        html, used_provider = generate_app_html(
            r.prompt, r.base_html, model_id=req.model, spec=r.byok_spec
        )
    except Exception as exc:  # noqa: BLE001 — surface upstream errors to the UI
        return JSONResponse(status_code=502, content={"error": f"generation failed: {exc}"})

    project_id, iterated = _persist_generation(r, html, used_provider)

    return {
        "html": html,
        "provider": used_provider,
        "project_id": project_id,
        "iterated": iterated,
    }


def _sse(obj: dict) -> str:
    """Encode one Server-Sent Event frame. ensure_ascii=False keeps CJK intact."""
    return f"data: {json.dumps(obj, ensure_ascii=False)}\n\n"


@app.post("/api/generate/stream")
def generate_stream(req: GenerateRequest, request: Request):
    """Streaming twin of /api/generate. Emits Server-Sent Events so the UI can
    show the model's reasoning and the code as they're produced, instead of the
    user staring at a spinner. Same validation, ownership, and persistence as
    the blocking endpoint; /api/generate stays as a non-streaming fallback.

    Event frames (JSON on each `data:` line):
      {"type":"model","label":...}          the model actually used
      {"type":"reasoning","delta":...}       chain-of-thought token(s)
      {"type":"content","delta":...}         raw HTML chunk(s)
      {"type":"done","html":...,"provider":...,"project_id":...,"iterated":...}
      {"type":"error","message":...}
    """
    r = _resolve_generate(req, request)
    if r.error is not None:
        return r.error

    def event_source():
        provider_label = ""
        try:
            for kind, payload in stream_app_html(
                r.prompt, r.base_html, model_id=req.model, spec=r.byok_spec
            ):
                if kind == "model":
                    provider_label = payload
                    yield _sse({"type": "model", "label": payload})
                elif kind == "reasoning":
                    yield _sse({"type": "reasoning", "delta": payload})
                elif kind == "content":
                    yield _sse({"type": "content", "delta": payload})
                elif kind == "error":
                    yield _sse({"type": "error", "message": payload})
                    return
                elif kind == "done":
                    project_id, iterated = _persist_generation(r, payload, provider_label)
                    yield _sse({
                        "type": "done",
                        "html": payload,
                        "provider": provider_label,
                        "project_id": project_id,
                        "iterated": iterated,
                    })
        except Exception as exc:  # noqa: BLE001 — never leave the stream hanging
            yield _sse({"type": "error", "message": f"generation failed: {exc}"})

    return StreamingResponse(
        event_source(),
        media_type="text/event-stream",
        headers={
            # Defeat proxy/CDN buffering so events actually reach the browser
            # incrementally (Render/nginx honor X-Accel-Buffering).
            "X-Accel-Buffering": "no",
            "Cache-Control": "no-cache",
        },
    )


# --- projects ------------------------------------------------------------

@app.get("/api/projects")
def projects(request: Request):
    user = auth.current_user(request)
    if user is None:
        return JSONResponse(status_code=401, content={"error": "login required"})
    rows = db.list_projects(user["id"])
    return {"projects": [dict(r) for r in rows]}


@app.get("/api/projects/{project_id}")
def project_detail(project_id: int, request: Request):
    user = auth.current_user(request)
    if user is None:
        return JSONResponse(status_code=401, content={"error": "login required"})
    row = db.get_project(user["id"], project_id)
    if row is None:
        return JSONResponse(status_code=404, content={"error": "not found"})
    return dict(row)


# --- version history + rollback ------------------------------------------

@app.get("/api/projects/{project_id}/versions")
def project_versions(project_id: int, request: Request):
    """List a project's version snapshots (newest first, metadata only). Every
    generate/iterate/restore appends one, so this is the app's undo history."""
    user = auth.current_user(request)
    if user is None:
        return JSONResponse(status_code=401, content={"error": "login required"})
    if db.get_project(user["id"], project_id) is None:
        return JSONResponse(status_code=404, content={"error": "not found"})
    rows = db.list_versions(user["id"], project_id)
    return {"versions": [dict(r) for r in rows]}


@app.get("/api/projects/{project_id}/versions/{version_id}")
def project_version_detail(project_id: int, version_id: int, request: Request):
    """Fetch one snapshot's full HTML — used to preview an old version before
    deciding whether to roll back to it."""
    user = auth.current_user(request)
    if user is None:
        return JSONResponse(status_code=401, content={"error": "login required"})
    row = db.get_version(user["id"], project_id, version_id)
    if row is None:
        return JSONResponse(status_code=404, content={"error": "not found"})
    return dict(row)


@app.post("/api/projects/{project_id}/versions/{version_id}/restore")
def project_version_restore(project_id: int, version_id: int, request: Request):
    """Roll the project back to an earlier snapshot. Non-destructive: the
    restore is itself appended as a new version, so nothing is lost and the
    user can roll forward again."""
    user = auth.current_user(request)
    if user is None:
        return JSONResponse(status_code=401, content={"error": "login required"})
    row = db.restore_version(user["id"], project_id, version_id)
    if row is None:
        return JSONResponse(status_code=404, content={"error": "not found"})
    return dict(row)


# --- frontend ------------------------------------------------------------

@app.get("/")
def index():
    return FileResponse(STATIC_DIR / "index.html")


@app.get("/login")
def login_page():
    return FileResponse(STATIC_DIR / "login.html")


app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
