"""Featured showcase (public gallery).

The gallery is served read-only from the real featured/ directory (manifest +
HTML files committed to the repo), so these tests assert the committed content
is reachable WITHOUT auth and that the slug/path-safety guards hold.
"""
from app import featured


# --- HTTP: list is public -------------------------------------------------

def test_featured_list_is_public_and_nonempty(client):
    """A guest (the fresh client isn't logged in) can list the gallery."""
    resp = client.get("/api/featured")
    assert resp.status_code == 200
    items = resp.json()["featured"]
    assert isinstance(items, list) and len(items) >= 1
    # Metadata only — the (large) HTML must NOT ride the list payload.
    for it in items:
        assert "slug" in it and "title" in it and "provider" in it
        assert "html" not in it


def test_featured_list_includes_curated_slugs(client):
    """The two apps we shipped are present in the gallery."""
    slugs = {it["slug"] for it in client.get("/api/featured").json()["featured"]}
    assert {"pomodoro", "city-explorer"} <= slugs


# --- HTTP: detail is public + carries HTML --------------------------------

def test_featured_detail_is_public_and_has_html(client):
    resp = client.get("/api/featured/pomodoro")
    assert resp.status_code == 200
    body = resp.json()
    assert body["slug"] == "pomodoro"
    assert body["title"] and body["title_en"]
    # A real, self-contained document.
    assert "<!DOCTYPE html>" in body["html"] or "<html" in body["html"].lower()


def test_every_listed_entry_is_fetchable(client):
    """Anything the list advertises must actually be openable (no dangling row)."""
    for it in client.get("/api/featured").json()["featured"]:
        detail = client.get(f"/api/featured/{it['slug']}")
        assert detail.status_code == 200, it["slug"]
        assert detail.json()["html"]


def test_featured_detail_unknown_slug_404(client):
    assert client.get("/api/featured/does-not-exist").status_code == 404


def test_featured_works_when_logged_out(client):
    """Explicit guest check: even after logging out, the gallery stays open."""
    client.post("/api/auth/logout")
    assert client.get("/api/featured").status_code == 200
    assert client.get("/api/featured/city-explorer").status_code == 200


# --- unit: slug + path-traversal safety -----------------------------------

def test_get_featured_rejects_traversal_and_bad_slugs():
    # Path-traversal / absolute / hidden-file shaped ids never resolve.
    for bad in ["../app/main", "..%2f..%2fetc", "/etc/passwd", ".", "", "Pomodoro", "a b"]:
        assert featured.get_featured(bad) is None


def test_safe_file_confines_to_featured_dir():
    # Escapes and non-files are rejected; a real in-dir file resolves.
    assert featured._safe_file("../app/main.py") is None
    assert featured._safe_file("/etc/passwd") is None
    assert featured._safe_file("nope.html") is None
    assert featured._safe_file("pomodoro.html") is not None
