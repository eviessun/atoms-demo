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
import re
from pathlib import Path

from fastapi import FastAPI, Request, Response
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import auth, db
from .config import available_models, settings
from .llm import generate_app_html

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
    mock). API keys themselves are NEVER included — the client only gets ids and
    labels and sends an id back on /api/generate."""
    return {
        "models": [
            {"id": m.id, "label": m.label, "free": m.free, "transport": m.transport}
            for m in available_models()
        ],
        "default": settings.default_model_id(),
    }


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
    prompt = (req.prompt or "").strip()
    if not prompt:
        return JSONResponse(status_code=400, content={"error": "prompt is required"})

    user = auth.current_user(request)

    # Resolve the base HTML to edit (if any), enforcing ownership for project_id.
    base_html = None
    target_project = None
    if req.project_id is not None:
        if user is None:
            return JSONResponse(status_code=401, content={"error": "login required"})
        target_project = db.get_project(user["id"], req.project_id)
        if target_project is None:
            return JSONResponse(status_code=404, content={"error": "project not found"})
        base_html = target_project["html"]
    elif req.base_html:
        base_html = req.base_html

    try:
        html, used_provider = generate_app_html(prompt, base_html, model_id=req.model)
    except Exception as exc:  # noqa: BLE001 — surface upstream errors to the UI
        return JSONResponse(status_code=502, content={"error": f"generation failed: {exc}"})

    # Persist: update in place when iterating on a saved project, else create.
    project_id = None
    iterated = False
    if target_project is not None:
        db.update_project_html(user["id"], target_project["id"], prompt, html, used_provider)
        project_id = target_project["id"]
        iterated = True
    elif user is not None:
        project_id = db.create_project(user["id"], prompt, html, used_provider)

    return {
        "html": html,
        "provider": used_provider,
        "project_id": project_id,
        "iterated": iterated,
    }


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


# --- frontend ------------------------------------------------------------

@app.get("/")
def index():
    return FileResponse(STATIC_DIR / "index.html")


@app.get("/login")
def login_page():
    return FileResponse(STATIC_DIR / "login.html")


app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
