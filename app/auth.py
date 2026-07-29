"""Authentication helpers (stdlib only).

Password hashing uses PBKDF2-HMAC-SHA256 (hashlib) — no bcrypt/argon2 dependency,
so nothing needs to compile on Render. Sessions are opaque random tokens stored in
the DB and carried in an httponly cookie.
"""
from __future__ import annotations

import hashlib
import hmac
import secrets
from typing import Optional

from fastapi import Request

from . import db

SESSION_COOKIE = "atoms_session"
_PBKDF2_ROUNDS = 200_000


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, _PBKDF2_ROUNDS)
    return f"pbkdf2_sha256${_PBKDF2_ROUNDS}${salt.hex()}${dk.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        algo, rounds_s, salt_hex, hash_hex = stored.split("$")
        if algo != "pbkdf2_sha256":
            return False
        dk = hashlib.pbkdf2_hmac(
            "sha256", password.encode(), bytes.fromhex(salt_hex), int(rounds_s)
        )
        return hmac.compare_digest(dk.hex(), hash_hex)
    except (ValueError, TypeError):
        return False


def new_session_token() -> str:
    return secrets.token_urlsafe(32)


def current_user(request: Request) -> Optional[dict]:
    """Return the logged-in user as a dict, or None. Never raises."""
    token = request.cookies.get(SESSION_COOKIE)
    if not token:
        return None
    row = db.get_user_by_session(token)
    if row is None:
        return None
    return {"id": row["id"], "email": row["email"]}
