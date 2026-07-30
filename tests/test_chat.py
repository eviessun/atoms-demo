"""Plain conversation turns via /api/chat (mock model, offline)."""

from .conftest import register


def test_chat_requires_prompt(client):
    resp = client.post("/api/chat", json={"prompt": "   ", "model": "mock"})
    assert resp.status_code == 400


def test_guest_chat_returns_plain_text_and_persists_nothing(client):
    resp = client.post("/api/chat", json={"prompt": "你好", "model": "mock"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["reply"]
    assert isinstance(body["reply"], str)
    assert "html" not in body


def test_logged_in_chat_does_not_create_a_project(client):
    register(client)
    resp = client.post("/api/chat", json={"prompt": "你能做什么？", "model": "mock"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["reply"]
    # Capability questions should explain how to use THIS system, not just chat
    # vaguely. Mention either creating a new app, modifying an opened project,
    # or switching Preview/Code.
    assert (
        "新应用" in body["reply"]
        or "项目" in body["reply"]
        or "预览" in body["reply"]
        or "代码" in body["reply"]
    )
    projects = client.get("/api/projects").json()["projects"]
    assert projects == []
