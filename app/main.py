"""Atoms Demo — FastAPI entry point.

Serves the frontend and exposes the generation API. At this skeleton stage the
generate endpoint already works end-to-end using the `mock` LLM provider, so the
whole pipeline (type request -> generate -> preview) is testable without any key.
"""
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from .config import settings
from .llm import generate_app_html

BASE_DIR = Path(__file__).resolve().parent.parent
STATIC_DIR = BASE_DIR / "static"

app = FastAPI(title=settings.APP_NAME)


class GenerateRequest(BaseModel):
    prompt: str


@app.get("/api/health")
def health():
    return {"status": "ok", "app": settings.APP_NAME, "llm_provider": settings.LLM_PROVIDER}


@app.post("/api/generate")
def generate(req: GenerateRequest):
    """Generate a self-contained HTML app from a natural-language prompt."""
    prompt = (req.prompt or "").strip()
    if not prompt:
        return JSONResponse(status_code=400, content={"error": "prompt is required"})
    try:
        html, used_provider = generate_app_html(prompt)
    except Exception as exc:  # noqa: BLE001 — surface upstream errors to the UI
        return JSONResponse(status_code=502, content={"error": f"generation failed: {exc}"})
    return {"html": html, "provider": used_provider}


@app.get("/")
def index():
    return FileResponse(STATIC_DIR / "index.html")


# Serve remaining static assets (css/js) under /static
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
