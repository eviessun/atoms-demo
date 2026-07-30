"""Server-side idempotency: a create carrying an idempotency_key can't fork a
duplicate project, no matter how many times it's replayed.

This is the server-side backstop for the duplicate-project bug: the frontend's
in-flight lock stops double-submits within a tab, but a dropped response +
client retry, or a proxy replay, can still deliver the same create twice. The
key makes the second delivery resolve to the original project.
"""
import uuid

from .conftest import register, generate


def test_same_key_creates_only_one_project(client):
    register(client)
    key = uuid.uuid4().hex
    first = generate(client, "a pomodoro timer", idempotency_key=key)
    second = generate(client, "a pomodoro timer", idempotency_key=key)
    assert first.status_code == second.status_code == 200
    # Both requests resolve to the SAME project id...
    assert first.json()["project_id"] == second.json()["project_id"]
    # ...and only one project exists.
    projects = client.get("/api/projects").json()["projects"]
    assert len(projects) == 1


def test_different_keys_create_distinct_projects(client):
    register(client)
    p1 = generate(client, "app one", idempotency_key=uuid.uuid4().hex).json()["project_id"]
    p2 = generate(client, "app two", idempotency_key=uuid.uuid4().hex).json()["project_id"]
    assert p1 != p2
    assert len(client.get("/api/projects").json()["projects"]) == 2


def test_missing_key_preserves_legacy_behavior(client):
    # No key => each create is independent (opt-out), as before the feature.
    register(client)
    generate(client, "app")
    generate(client, "app")
    assert len(client.get("/api/projects").json()["projects"]) == 2


def test_key_is_scoped_per_user(client):
    # The same key value used by two different users must NOT collide — the
    # unique index is on (user_id, idempotency_key).
    from fastapi.testclient import TestClient
    from app.main import app

    key = uuid.uuid4().hex
    register(client)
    a_pid = generate(client, "A's app", idempotency_key=key).json()["project_id"]
    with TestClient(app) as other:
        register(other)
        b_pid = generate(other, "B's app", idempotency_key=key).json()["project_id"]
        # B gets their own project despite reusing A's key value.
        assert len(other.get("/api/projects").json()["projects"]) == 1
    assert a_pid != b_pid
