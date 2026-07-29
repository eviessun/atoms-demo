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
from .config import settings
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


class AuthRequest(BaseModel):
    email: str
    password: str


# --- health --------------------------------------------------------------

@app.get("/api/health")
def health():
    return {"status": "ok", "app": settings.APP_NAME, "llm_provider": settings.LLM_PROVIDER}


# --- auth ----------------------------------------------------------------

def _set_session_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        auth.SESSION_COOKIE, token,
        httponly=True, samesite="lax", secure=True, max_age=60 * 60 * 24 * 30,
    )


@app.post("/api/auth/register")
def register(req: AuthRequest, response: Response):
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
    _set_session_cookie(response, token)
    return {"id": user_id, "email": email}


@app.post("/api/auth/login")
def login(req: AuthRequest, response: Response):
    email = req.email.strip().lower()
    row = db.get_user_by_email(email)
    if row is None or not auth.verify_password(req.password, row["password_hash"]):
        return JSONResponse(status_code=401, content={"error": "invalid email or password"})
    token = auth.new_session_token()
    db.create_session(token, row["id"])
    _set_session_cookie(response, token)
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
    """Generate a self-contained HTML app; persist it if the user is logged in."""
    prompt = (req.prompt or "").strip()
    if not prompt:
        return JSONResponse(status_code=400, content={"error": "prompt is required"})
    try:
        html, used_provider = generate_app_html(prompt)
    except Exception as exc:  # noqa: BLE001 — surface upstream errors to the UI
        return JSONResponse(status_code=502, content={"error": f"generation failed: {exc}"})

    project_id = None
    user = auth.current_user(request)
    if user is not None:
        project_id = db.create_project(user["id"], prompt, html, used_provider)

    return {"html": html, "provider": used_provider, "project_id": project_id}


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
