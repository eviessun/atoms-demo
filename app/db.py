"""Persistence layer with two interchangeable backends.

Backend is chosen at import time by the environment:
  * DATABASE_URL set  -> PostgreSQL (via psycopg 3). Use this on Render/Neon for
                         durable storage that survives redeploys/restarts.
  * DATABASE_URL unset -> SQLite file at DB_PATH (stdlib, zero-config local dev).

The public API (init_db, create_user, get_user_by_email, create_session,
get_user_by_session, delete_session, create_project, list_projects, get_project)
is identical for both backends, so app code never needs to know which is active.
Rows are returned as mappings supporting row["col"] and dict(row) on both backends.

Tables:
  users            — id, email (unique), password_hash, created_at
  sessions         — token (pk), user_id, created_at
  projects         — id, user_id, prompt, html, provider, created_at
  project_versions — id, project_id, prompt, html, provider, created_at
                     (append-only snapshot per generate/iterate/restore; the
                      projects.html column always mirrors the latest version)
"""
from __future__ import annotations

import os
import sqlite3
from pathlib import Path
from typing import Any, Optional

from dotenv import load_dotenv

# Load .env before reading DATABASE_URL: db is imported before config in main.py,
# so we can't rely on config.py having populated the environment yet. (On Render,
# DATABASE_URL is a real env var and this is a harmless no-op.)
load_dotenv()

BASE_DIR = Path(__file__).resolve().parent.parent

DATABASE_URL = os.getenv("DATABASE_URL", "").strip()
IS_POSTGRES = bool(DATABASE_URL)

# Only used by the SQLite backend.
DB_PATH = os.getenv("DB_PATH", str(BASE_DIR / "atoms_demo.db"))

if IS_POSTGRES:
    import psycopg
    from psycopg.rows import dict_row


# --- schema (per-backend dialect differences) ---------------------------

_SCHEMA_SQLITE = """
CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    email         TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS sessions (
    token      TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS projects (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL,
    prompt     TEXT NOT NULL,
    html       TEXT NOT NULL,
    provider   TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS project_versions (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL,
    prompt     TEXT NOT NULL,
    html       TEXT NOT NULL,
    provider   TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (project_id) REFERENCES projects(id)
);
CREATE INDEX IF NOT EXISTS idx_pv_project ON project_versions(project_id);
"""

_SCHEMA_POSTGRES = """
CREATE TABLE IF NOT EXISTS users (
    id            BIGSERIAL PRIMARY KEY,
    email         TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sessions (
    token      TEXT PRIMARY KEY,
    user_id    BIGINT NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS projects (
    id         BIGSERIAL PRIMARY KEY,
    user_id    BIGINT NOT NULL REFERENCES users(id),
    prompt     TEXT NOT NULL,
    html       TEXT NOT NULL,
    provider   TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS project_versions (
    id         BIGSERIAL PRIMARY KEY,
    project_id BIGINT NOT NULL REFERENCES projects(id),
    prompt     TEXT NOT NULL,
    html       TEXT NOT NULL,
    provider   TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pv_project ON project_versions(project_id);
"""


# --- connection + query helpers -----------------------------------------

def get_conn():
    """Open a connection. Both backends: `with get_conn() as conn:` commits on
    success. (psycopg also closes on exit; sqlite leaves it to GC — both fine
    since every call opens its own short-lived connection.)"""
    if IS_POSTGRES:
        return psycopg.connect(DATABASE_URL, row_factory=dict_row)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON;")
    return conn


def _q(sql: str) -> str:
    """SQL is written with sqlite-style '?' placeholders; translate to '%s' for
    psycopg. Safe here because our SQL never contains a literal '?'."""
    return sql.replace("?", "%s") if IS_POSTGRES else sql


def _insert_returning_id(conn, sql: str, params: tuple[Any, ...]) -> int:
    """Run an INSERT and return the new row's id, bridging lastrowid (sqlite)
    and RETURNING (postgres)."""
    if IS_POSTGRES:
        with conn.cursor() as cur:
            cur.execute(_q(sql) + " RETURNING id", params)
            return int(cur.fetchone()["id"])
    cur = conn.execute(sql, params)
    return int(cur.lastrowid)


def _execute(conn, sql: str, params: tuple[Any, ...] = ()) -> None:
    if IS_POSTGRES:
        with conn.cursor() as cur:
            cur.execute(_q(sql), params)
    else:
        conn.execute(sql, params)


def _fetchone(conn, sql: str, params: tuple[Any, ...] = ()):
    if IS_POSTGRES:
        with conn.cursor() as cur:
            cur.execute(_q(sql), params)
            return cur.fetchone()
    return conn.execute(sql, params).fetchone()


def _fetchall(conn, sql: str, params: tuple[Any, ...] = ()) -> list:
    if IS_POSTGRES:
        with conn.cursor() as cur:
            cur.execute(_q(sql), params)
            return cur.fetchall()
    return conn.execute(sql, params).fetchall()


def init_db() -> None:
    schema = _SCHEMA_POSTGRES if IS_POSTGRES else _SCHEMA_SQLITE
    with get_conn() as conn:
        if IS_POSTGRES:
            with conn.cursor() as cur:
                cur.execute(schema)
        else:
            conn.executescript(schema)
    # Give any pre-versioning projects an initial snapshot (idempotent).
    backfill_versions()


# --- users ---------------------------------------------------------------

def create_user(email: str, password_hash: str) -> int:
    with get_conn() as conn:
        return _insert_returning_id(
            conn,
            "INSERT INTO users (email, password_hash) VALUES (?, ?)",
            (email, password_hash),
        )


def get_user_by_email(email: str) -> Optional[Any]:
    with get_conn() as conn:
        return _fetchone(conn, "SELECT * FROM users WHERE email = ?", (email,))


# --- sessions ------------------------------------------------------------

def create_session(token: str, user_id: int) -> None:
    with get_conn() as conn:
        _execute(
            conn,
            "INSERT INTO sessions (token, user_id) VALUES (?, ?)",
            (token, user_id),
        )


def get_user_by_session(token: str) -> Optional[Any]:
    with get_conn() as conn:
        return _fetchone(
            conn,
            """
            SELECT u.* FROM users u
            JOIN sessions s ON s.user_id = u.id
            WHERE s.token = ?
            """,
            (token,),
        )


def delete_session(token: str) -> None:
    with get_conn() as conn:
        _execute(conn, "DELETE FROM sessions WHERE token = ?", (token,))


# --- projects ------------------------------------------------------------

def create_project(user_id: int, prompt: str, html: str, provider: str) -> int:
    """Create a project and record its first version snapshot in one
    transaction. projects.html is the 'current' state; project_versions is the
    append-only history that powers rollback."""
    with get_conn() as conn:
        project_id = _insert_returning_id(
            conn,
            "INSERT INTO projects (user_id, prompt, html, provider) VALUES (?, ?, ?, ?)",
            (user_id, prompt, html, provider),
        )
        _execute(
            conn,
            "INSERT INTO project_versions (project_id, prompt, html, provider) VALUES (?, ?, ?, ?)",
            (project_id, prompt, html, provider),
        )
        return project_id


def list_projects(user_id: int) -> list:
    with get_conn() as conn:
        return _fetchall(
            conn,
            """
            SELECT id, prompt, provider, created_at
            FROM projects WHERE user_id = ?
            ORDER BY id DESC
            """,
            (user_id,),
        )


def get_project(user_id: int, project_id: int) -> Optional[Any]:
    with get_conn() as conn:
        return _fetchone(
            conn,
            "SELECT * FROM projects WHERE id = ? AND user_id = ?",
            (project_id, user_id),
        )


def update_project_html(user_id: int, project_id: int, prompt: str, html: str, provider: str) -> bool:
    """Update an existing project in place (iterate loop) and append a new
    version snapshot, in one transaction. Owner-scoped: the WHERE clause
    includes user_id so a user can only modify their own project. Returns True
    if a row was updated, False if not found / not owned.

    `prompt` records the latest change request and `provider` the model that
    produced this revision. The projects row holds the newest state (shown in
    the list); every revision is preserved in project_versions for rollback."""
    with get_conn() as conn:
        if IS_POSTGRES:
            with conn.cursor() as cur:
                cur.execute(
                    _q(
                        "UPDATE projects SET prompt = ?, html = ?, provider = ? "
                        "WHERE id = ? AND user_id = ?"
                    ),
                    (prompt, html, provider, project_id, user_id),
                )
                updated = cur.rowcount > 0
        else:
            cur = conn.execute(
                "UPDATE projects SET prompt = ?, html = ?, provider = ? "
                "WHERE id = ? AND user_id = ?",
                (prompt, html, provider, project_id, user_id),
            )
            updated = cur.rowcount > 0
        if updated:
            _execute(
                conn,
                "INSERT INTO project_versions (project_id, prompt, html, provider) VALUES (?, ?, ?, ?)",
                (project_id, prompt, html, provider),
            )
        return updated


# --- project versions (history + rollback) -------------------------------

def list_versions(user_id: int, project_id: int) -> list:
    """List a project's version snapshots (newest first), owner-scoped via a
    join on projects.user_id. Omits the (large) html column — the list view
    only needs metadata; html is fetched per-version on demand."""
    with get_conn() as conn:
        return _fetchall(
            conn,
            """
            SELECT v.id, v.prompt, v.provider, v.created_at
            FROM project_versions v
            JOIN projects p ON p.id = v.project_id
            WHERE v.project_id = ? AND p.user_id = ?
            ORDER BY v.id DESC
            """,
            (project_id, user_id),
        )


def get_version(user_id: int, project_id: int, version_id: int) -> Optional[Any]:
    """Fetch one version snapshot (including html), owner-scoped."""
    with get_conn() as conn:
        return _fetchone(
            conn,
            """
            SELECT v.id, v.project_id, v.prompt, v.html, v.provider, v.created_at
            FROM project_versions v
            JOIN projects p ON p.id = v.project_id
            WHERE v.id = ? AND v.project_id = ? AND p.user_id = ?
            """,
            (version_id, project_id, user_id),
        )


def restore_version(user_id: int, project_id: int, version_id: int) -> Optional[Any]:
    """Roll a project back to an earlier version. Non-destructive: we copy the
    target snapshot's html/prompt/provider onto the current project AND append
    it as a NEW version, so the history is never truncated (you can always roll
    forward again). Returns the restored project row, or None if the version
    isn't found / not owned. Runs in a single transaction."""
    with get_conn() as conn:
        target = _fetchone(
            conn,
            """
            SELECT v.prompt, v.html, v.provider
            FROM project_versions v
            JOIN projects p ON p.id = v.project_id
            WHERE v.id = ? AND v.project_id = ? AND p.user_id = ?
            """,
            (version_id, project_id, user_id),
        )
        if target is None:
            return None
        prompt = f"↩ restored v{version_id}: {target['prompt']}"
        html, provider = target["html"], target["provider"]
        _execute(
            conn,
            "UPDATE projects SET prompt = ?, html = ?, provider = ? "
            "WHERE id = ? AND user_id = ?",
            (prompt, html, provider, project_id, user_id),
        )
        _execute(
            conn,
            "INSERT INTO project_versions (project_id, prompt, html, provider) VALUES (?, ?, ?, ?)",
            (project_id, prompt, html, provider),
        )
        return _fetchone(
            conn,
            "SELECT * FROM projects WHERE id = ? AND user_id = ?",
            (project_id, user_id),
        )


def backfill_versions() -> None:
    """One-time migration for projects created before versioning existed: give
    each project with zero versions an initial snapshot from its current state,
    so their history isn't empty. Idempotent — safe to run on every startup."""
    with get_conn() as conn:
        orphans = _fetchall(
            conn,
            """
            SELECT p.id, p.prompt, p.html, p.provider
            FROM projects p
            LEFT JOIN project_versions v ON v.project_id = p.id
            WHERE v.id IS NULL
            """,
        )
        for row in orphans:
            _execute(
                conn,
                "INSERT INTO project_versions (project_id, prompt, html, provider) VALUES (?, ?, ?, ?)",
                (row["id"], row["prompt"], row["html"], row["provider"]),
            )
