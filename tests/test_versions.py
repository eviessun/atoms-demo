"""Version history + non-destructive rollback."""
from .conftest import register, generate


def test_create_then_iterate_builds_history(client):
    register(client)
    pid = generate(client, "v1: a notes app").json()["project_id"]
    generate(client, "v2: add dark mode", project_id=pid)
    versions = client.get(f"/api/projects/{pid}/versions").json()["versions"]
    # Two snapshots: the initial create + one iterate, newest first.
    assert len(versions) == 2
    assert versions[0]["id"] > versions[1]["id"]


def test_version_detail_returns_html(client):
    register(client)
    pid = generate(client, "an app").json()["project_id"]
    versions = client.get(f"/api/projects/{pid}/versions").json()["versions"]
    vid = versions[0]["id"]
    detail = client.get(f"/api/projects/{pid}/versions/{vid}").json()
    assert detail["id"] == vid
    assert detail["html"]


def test_restore_is_non_destructive(client):
    register(client)
    pid = generate(client, "v1").json()["project_id"]
    v1_html = client.get(f"/api/projects/{pid}").json()["html"]
    generate(client, "v2 changes", project_id=pid)

    versions = client.get(f"/api/projects/{pid}/versions").json()["versions"]
    assert len(versions) == 2
    v1_id = versions[-1]["id"]        # oldest == the initial create

    # Roll back to v1.
    resp = client.post(f"/api/projects/{pid}/versions/{v1_id}/restore")
    assert resp.status_code == 200
    # Current project html now matches v1 again...
    assert client.get(f"/api/projects/{pid}").json()["html"] == v1_html
    # ...and the restore was APPENDED (history grows to 3, nothing truncated).
    versions_after = client.get(f"/api/projects/{pid}/versions").json()["versions"]
    assert len(versions_after) == 3


def test_restore_missing_version_404s(client):
    register(client)
    pid = generate(client, "an app").json()["project_id"]
    assert client.post(f"/api/projects/{pid}/versions/999999/restore").status_code == 404


def test_versions_require_login(client):
    assert client.get("/api/projects/1/versions").status_code == 401
