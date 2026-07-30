"""Ownership isolation: a user can only see/modify their OWN projects.

Each TestClient has its own cookie jar, so two clients built from the same app
are two independent logged-in users — the natural way to test cross-user access.
"""
from fastapi.testclient import TestClient

from app.main import app
from .conftest import register, generate


def _second_client():
    return TestClient(app)


def test_projects_list_requires_login(client):
    # Fresh client fixture is not logged in until we register.
    assert client.get("/api/auth/me").json()["user"] is None
    assert client.get("/api/projects").status_code == 401


def test_project_list_is_scoped_to_owner(client):
    register(client)                       # user A (client)
    generate(client, "A's app")
    with _second_client() as other:
        register(other)                    # user B
        generate(other, "B's app")
        # B sees only their own one project, not A's.
        b_projects = other.get("/api/projects").json()["projects"]
        assert len(b_projects) == 1
    a_projects = client.get("/api/projects").json()["projects"]
    assert len(a_projects) == 1
    assert a_projects[0]["id"] != b_projects[0]["id"]


def test_cannot_read_another_users_project(client):
    register(client)
    a_pid = generate(client, "A's secret app").json()["project_id"]
    with _second_client() as other:
        register(other)
        # B tries to fetch A's project by id -> 404 (owner-scoped, not 403 to
        # avoid leaking existence).
        assert other.get(f"/api/projects/{a_pid}").status_code == 404


def test_cannot_iterate_on_another_users_project(client):
    register(client)
    a_pid = generate(client, "A's app").json()["project_id"]
    with _second_client() as other:
        register(other)
        # B tries to iterate on A's project -> 404, and A's project is untouched.
        assert generate(other, "hijack", project_id=a_pid).status_code == 404


def test_cannot_read_another_users_versions(client):
    register(client)
    a_pid = generate(client, "A's app").json()["project_id"]
    with _second_client() as other:
        register(other)
        assert other.get(f"/api/projects/{a_pid}/versions").status_code == 404
