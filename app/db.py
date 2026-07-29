"""SQLite persistence layer (stdlib only — no extra deps to break the build).

Tables:
  users     — id, email (unique), password_hash, created_at
  sessions  — token (pk), user_id, created_at
  projects  — id, user_id, prompt, html, provider, created_at

Note on Render free tier: the disk is ephemeral, so data resets on redeploy/restart.
That's fine to demonstrate persistence within a run; swap DB_PATH to a mounted disk
or point at Postgres for durable storage later. Kept swappable via the DB_PATH env.
"""
from __future__ import annotations

import os
import sqlite3
from pathlib import Path
from typing import Optional

BASE_DIR = Path(__file__).resolve().parent.parent
DB_PATH = os.getenv("DB_PATH", str(BASE_DIR / "atoms_demo.db"))

SCHEMA = """
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


def get_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON;")
    return conn


def init_db() -> None:
    with get_conn() as conn:
        conn.executescript(SCHEMA)


# --- users ---------------------------------------------------------------

def create_user(email: str, password_hash: str) -> int:
    with get_conn() as conn:
        cur = conn.execute(
            "INSERT INTO users (email, password_hash) VALUES (?, ?)",
            (email, password_hash),
        )
        return int(cur.lastrowid)


def get_user_by_email(email: str) -> Optional[sqlite3.Row]:
    with get_conn() as conn:
        return conn.execute(
            "SELECT * FROM users WHERE email = ?", (email,)
        ).fetchone()


# --- sessions ------------------------------------------------------------

def create_session(token: str, user_id: int) -> None:
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO sessions (token, user_id) VALUES (?, ?)",
            (token, user_id),
        )


def get_user_by_session(token: str) -> Optional[sqlite3.Row]:
    with get_conn() as conn:
        return conn.execute(
            """
            SELECT u.* FROM users u
            JOIN sessions s ON s.user_id = u.id
            WHERE s.token = ?
            """,
            (token,),
        ).fetchone()


def delete_session(token: str) -> None:
    with get_conn() as conn:
        conn.execute("DELETE FROM sessions WHERE token = ?", (token,))


# --- projects ------------------------------------------------------------

def create_project(user_id: int, prompt: str, html: str, provider: str) -> int:
    with get_conn() as conn:
        cur = conn.execute(
            "INSERT INTO projects (user_id, prompt, html, provider) VALUES (?, ?, ?, ?)",
            (user_id, prompt, html, provider),
        )
        return int(cur.lastrowid)


def list_projects(user_id: int) -> list[sqlite3.Row]:
    with get_conn() as conn:
        return conn.execute(
            """
            SELECT id, prompt, provider, created_at
            FROM projects WHERE user_id = ?
            ORDER BY id DESC
            """,
            (user_id,),
        ).fetchall()


def get_project(user_id: int, project_id: int) -> Optional[sqlite3.Row]:
    with get_conn() as conn:
        return conn.execute(
            "SELECT * FROM projects WHERE id = ? AND user_id = ?",
            (project_id, user_id),
        ).fetchone()
