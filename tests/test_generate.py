"""Generation: create + iterate via /api/generate (mock model, offline)."""
from .conftest import register, generate


def test_generate_requires_prompt(client):
    resp = generate(client, "   ")
    assert resp.status_code == 400


def test_guest_generate_returns_html_but_persists_nothing(client):
    # No login: the mock model still returns HTML, but nothing is saved and
    # there's no project_id.
    resp = generate(client, "a todo list")
    assert resp.status_code == 200
    body = resp.json()
    assert body["html"]
    assert body["project_id"] is None
    assert body["iterated"] is False


def test_logged_in_create_persists_project(client):
    register(client)
    resp = generate(client, "a pomodoro timer")
    assert resp.status_code == 200
    body = resp.json()
    assert body["project_id"] is not None
    assert body["iterated"] is False
    # It shows up in the user's project list.
    projects = client.get("/api/projects").json()["projects"]
    assert len(projects) == 1
    assert projects[0]["id"] == body["project_id"]


def test_iterate_updates_in_place_not_forking(client):
    register(client)
    pid = generate(client, "a counter app").json()["project_id"]
    resp = generate(client, "make the button blue", project_id=pid)
    assert resp.status_code == 200
    body = resp.json()
    assert body["iterated"] is True
    assert body["project_id"] == pid
    # Still exactly one project — iterate edits in place.
    projects = client.get("/api/projects").json()["projects"]
    assert len(projects) == 1


def test_iterate_on_missing_project_404s(client):
    register(client)
    resp = generate(client, "edit it", project_id=999999)
    assert resp.status_code == 404


def test_iterate_requires_login(client):
    # project_id without a session -> 401 (can't own a project as a guest).
    resp = generate(client, "edit it", project_id=1)
    assert resp.status_code == 401
