"""Auth: registration, login, session cookie, and /api/auth/me."""
import uuid

from .conftest import register


def test_register_logs_in_and_me_returns_user(client):
    email = register(client)
    me = client.get("/api/auth/me")
    assert me.status_code == 200
    assert me.json()["user"]["email"] == email


def test_register_rejects_bad_email(client):
    resp = client.post("/api/auth/register", json={"email": "not-an-email", "password": "secret123"})
    assert resp.status_code == 400


def test_register_rejects_short_password(client):
    resp = client.post("/api/auth/register",
                       json={"email": f"{uuid.uuid4().hex}@x.com", "password": "123"})
    assert resp.status_code == 400


def test_register_duplicate_email_conflicts(client):
    email = register(client)
    resp = client.post("/api/auth/register", json={"email": email, "password": "secret123"})
    assert resp.status_code == 409


def test_login_wrong_password_rejected(client):
    email = register(client, password="rightpass")
    client.post("/api/auth/logout")
    resp = client.post("/api/auth/login", json={"email": email, "password": "wrongpass"})
    assert resp.status_code == 401


def test_login_roundtrip(client):
    email = register(client, password="mypassword")
    client.post("/api/auth/logout")
    assert client.get("/api/auth/me").json()["user"] is None
    resp = client.post("/api/auth/login", json={"email": email, "password": "mypassword"})
    assert resp.status_code == 200
    assert client.get("/api/auth/me").json()["user"]["email"] == email


def test_logout_clears_session(client):
    register(client)
    assert client.get("/api/auth/me").json()["user"] is not None
    client.post("/api/auth/logout")
    assert client.get("/api/auth/me").json()["user"] is None
