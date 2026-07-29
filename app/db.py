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
  users     — id, email (unique), password_hash, created_at
  sessions  — token (pk), user_id, created_at
  projects  — id, user_id, prompt, html, provider, created_at
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
    with get_conn() as conn:
        return _insert_returning_id(
            conn,
            "INSERT INTO projects (user_id, prompt, html, provider) VALUES (?, ?, ?, ?)",
            (user_id, prompt, html, provider),
        )


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
