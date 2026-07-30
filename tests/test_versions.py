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


def test_iterate_keeps_original_title(client):
    # The project title (projects.prompt) is the FIRST request and must not be
    # overwritten by a later iterate — regression guard for the list/banner
    # showing "make the button blue" instead of the app's original purpose.
    register(client)
    pid = generate(client, "a pomodoro timer").json()["project_id"]
    generate(client, "make the button blue", project_id=pid)
    generate(client, "add a dark mode toggle", project_id=pid)

    # Project title stays the original first prompt...
    assert client.get(f"/api/projects/{pid}").json()["prompt"] == "a pomodoro timer"
    proj = next(p for p in client.get("/api/projects").json()["projects"] if p["id"] == pid)
    assert proj["prompt"] == "a pomodoro timer"
    # ...while each iterate is still recorded in the version history.
    version_prompts = [v["prompt"] for v in
                       client.get(f"/api/projects/{pid}/versions").json()["versions"]]
    assert "make the button blue" in version_prompts
    assert "add a dark mode toggle" in version_prompts


def test_restore_keeps_original_title(client):
    # A rollback must not rename the project to "↩ restored v…"; that marker
    # belongs only on the appended version snapshot.
    register(client)
    pid = generate(client, "a counter app").json()["project_id"]
    generate(client, "make it red", project_id=pid)
    v1_id = client.get(f"/api/projects/{pid}/versions").json()["versions"][-1]["id"]

    restored = client.post(f"/api/projects/{pid}/versions/{v1_id}/restore").json()
    assert restored["prompt"] == "a counter app"          # title unchanged
    # The restore marker is present in history, not in the title.
    top_version = client.get(f"/api/projects/{pid}/versions").json()["versions"][0]
    assert top_version["prompt"].startswith("↩ restored")
