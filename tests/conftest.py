"""Shared pytest fixtures.

Test isolation strategy
-----------------------
The persistence layer (`app.db`) resolves its backend from the environment *at
import time*: DATABASE_URL -> Postgres, else a SQLite file at DB_PATH. To keep
the suite hermetic — never touching the real Neon database, no network, fully
deterministic — we pin the environment BEFORE importing any app module:

  * DATABASE_URL = ""       -> force the SQLite backend
  * DEFAULT_MODEL_ID = mock -> generation uses the keyless mock (no API calls)
  * provider keys cleared   -> /api/models is deterministic

python-dotenv's load_dotenv (called inside app.db / app.config) uses
override=False, so these pre-set values win over whatever .env contains.

Each test then gets its OWN fresh SQLite file via the `client` fixture, which
repoints db.DB_PATH and re-inits the schema, so tests never see each other's rows.
"""
import os
import uuid

# --- pin env BEFORE importing app modules (import-time backend selection) ---
os.environ["DATABASE_URL"] = ""            # force SQLite, never hit Neon
os.environ["DEFAULT_MODEL_ID"] = "mock"    # keyless, offline generation
for _k in ("OPENROUTER_API_KEY", "DEEPSEEK_API_KEY", "DOUBAO_API_KEY",
           "MOONSHOT_API_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY"):
    os.environ[_k] = ""

import pytest
from fastapi.testclient import TestClient

from app import db
from app.main import app


@pytest.fixture
def client(tmp_path, monkeypatch):
    """A TestClient backed by a throwaway SQLite file, schema freshly created.

    db.DB_PATH is a module constant read by get_conn() on each call, so
    monkeypatching it per test gives full row isolation. The returned client
    keeps its own cookie jar, so calling /api/auth/register on it logs that
    client in for subsequent requests."""
    db_file = tmp_path / f"test_{uuid.uuid4().hex}.db"
    monkeypatch.setattr(db, "DB_PATH", str(db_file))
    db.init_db()
    with TestClient(app) as c:
        yield c


def register(client, email=None, password="secret123"):
    """Register a fresh user on `client` (logs it in via the session cookie).
    Returns the created user's email. Emails are unique per call."""
    email = email or f"user_{uuid.uuid4().hex}@example.com"
    resp = client.post("/api/auth/register", json={"email": email, "password": password})
    assert resp.status_code == 200, resp.text
    return email


def generate(client, prompt, **extra):
    """POST /api/generate (blocking path) with the mock model. Extra kwargs
    (project_id, base_html, idempotency_key, ...) are merged into the body."""
    body = {"prompt": prompt, "model": "mock", **extra}
    return client.post("/api/generate", json=body)
