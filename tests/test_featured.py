"""Featured showcase (public gallery).

The gallery is served read-only from the real featured/ directory (manifest +
per-app subdirectories committed to the repo), so these tests assert the
committed content is reachable WITHOUT auth and that the slug/path-safety
guards hold.
"""
from app import featured


# --- HTTP: list is public -------------------------------------------------

def test_featured_list_is_public_and_nonempty(client):
    """A guest (the fresh client isn't logged in) can list the gallery."""
    resp = client.get("/api/featured")
    assert resp.status_code == 200
    items = resp.json()["featured"]
    assert isinstance(items, list) and len(items) >= 1
    # Metadata only — file bodies must NOT ride the list payload.
    for it in items:
        assert "slug" in it and "title" in it and "provider" in it
        assert "files" not in it and "html" not in it


def test_featured_list_includes_curated_slugs(client):
    """The two apps we shipped are present in the gallery."""
    slugs = {it["slug"] for it in client.get("/api/featured").json()["featured"]}
    assert {"pomodoro", "city-explorer"} <= slugs


# --- HTTP: detail returns a multi-file bundle -----------------------------

def test_featured_detail_returns_multi_file_bundle(client):
    resp = client.get("/api/featured/pomodoro")
    assert resp.status_code == 200
    body = resp.json()
    assert body["slug"] == "pomodoro"
    assert body["title"] and body["title_en"]
    assert body["entry"] == "index.html"

    files = body["files"]
    assert isinstance(files, list) and len(files) >= 2
    # Entry sits first so the frontend can default to opening it.
    assert files[0]["name"] == "index.html"
    # Every file carries its raw source + a language tag for syntax hinting.
    for f in files:
        assert set(f) == {"name", "language", "content"}
        assert isinstance(f["content"], str) and f["content"]
    names = [f["name"] for f in files]
    assert "style.css" in names and "app.js" in names


def test_every_listed_entry_is_fetchable(client):
    """Anything the list advertises must actually be openable (no dangling row)."""
    for it in client.get("/api/featured").json()["featured"]:
        detail = client.get(f"/api/featured/{it['slug']}")
        assert detail.status_code == 200, it["slug"]
        body = detail.json()
        assert body["files"], f"{it['slug']} has no files"
        assert body["files"][0]["name"] == body["entry"]


def test_featured_detail_unknown_slug_404(client):
    assert client.get("/api/featured/does-not-exist").status_code == 404


def test_featured_works_when_logged_out(client):
    """Explicit guest check: even after logging out, the gallery stays open."""
    client.post("/api/auth/logout")
    assert client.get("/api/featured").status_code == 200
    assert client.get("/api/featured/city-explorer").status_code == 200


# --- HTTP: static file endpoint -------------------------------------------

def test_featured_file_serves_entry_html(client):
    """The static endpoint feeds the preview iframe with the app's own HTML."""
    resp = client.get("/featured-files/pomodoro/index.html")
    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("text/html")
    body = resp.text
    # Multi-file layout: the split entry links external css/js by relative ref.
    assert '<link rel="stylesheet" href="style.css">' in body
    assert '<script src="app.js"></script>' in body


def test_featured_file_serves_css_with_css_mime(client):
    resp = client.get("/featured-files/pomodoro/style.css")
    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("text/css")


def test_featured_file_rejects_traversal(client):
    """Slug/name safety: path traversal never leaks files outside featured/<slug>/."""
    # `..` is invalid as a filename segment, but the endpoint also enforces the
    # resolved-path guard so a symlinked-out target would still be refused.
    for bad_name in ["../manifest.json", "..%2fmanifest.json", "manifest.json", "nope.html"]:
        assert client.get(f"/featured-files/pomodoro/{bad_name}").status_code == 404
    for bad_slug in ["../pomodoro", ".hidden", "no such slug"]:
        assert client.get(f"/featured-files/{bad_slug}/index.html").status_code == 404


# --- unit: slug + path-traversal safety -----------------------------------

def test_get_featured_rejects_traversal_and_bad_slugs():
    # Path-traversal / absolute / hidden-file shaped ids never resolve.
    for bad in ["../app/main", "..%2f..%2fetc", "/etc/passwd", ".", "", "Pomodoro", "a b"]:
        assert featured.get_featured(bad) is None


def test_read_file_confines_to_featured_dir():
    # Escapes and non-files are rejected; a real in-dir file resolves.
    assert featured.read_file("pomodoro", "../manifest.json") is None
    assert featured.read_file("pomodoro", "/etc/passwd") is None
    assert featured.read_file("pomodoro", "nope.html") is None
    resolved = featured.read_file("pomodoro", "index.html")
    assert resolved is not None
    path, lang = resolved
    assert path.name == "index.html" and lang == "html"
