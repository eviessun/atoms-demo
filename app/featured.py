"""Featured showcase — a curated gallery of example apps guests can browse.

These are apps we generated ahead of time with the same model pipeline as the
live generator; we simply persist the finished HTML on disk and serve it read-
only. Unlike `projects` (per-user, login-gated), the showcase is PUBLIC: a guest
can open the home page and preview a polished pomodoro timer or a city-switching
travel map without an account — the "come see what this can build" front door.

Storage is a plain directory so the artifacts are reviewable in git:

    featured/
      manifest.json        # ordered list of entries (metadata only, no HTML)
      pomodoro.html        # each entry's self-contained single-file app
      city-explorer.html

manifest.json shape:
    {
      "projects": [
        {
          "slug": "pomodoro",            # url-safe id; also the HTML filename stem
          "title": "番茄钟计时器",         # zh title
          "title_en": "Pomodoro Timer",  # en title
          "description": "…",             # zh one-liner
          "description_en": "…",          # en one-liner
          "provider": "Nemotron 3 Nano",  # model that produced it (badge)
          "file": "pomodoro.html"         # HTML file, resolved INSIDE featured/
        }
      ]
    }

Everything here is read-only and cached in memory: the manifest + files are
loaded once and reused, so serving the gallery costs no disk I/O per request.
"""
from __future__ import annotations

import json
import re
from functools import lru_cache
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
FEATURED_DIR = BASE_DIR / "featured"
MANIFEST_PATH = FEATURED_DIR / "manifest.json"

# A slug is our own id namespace; keep it strict so it can never be coerced into
# a path traversal ("../"), an absolute path, or a hidden file. The manifest is
# ours, but validating here means a bad hand-edit fails safe instead of leaking
# files outside featured/.
_SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9-]*$")


def _safe_file(name: str) -> Path | None:
    """Resolve a manifest `file` to a real path INSIDE featured/, or None.

    Rejects anything that escapes the directory (``../``, absolute paths,
    symlinked-out targets) by comparing the resolved path against the resolved
    featured dir — so a malformed manifest entry can't read arbitrary files."""
    if not name or "/" in name or "\\" in name or name.startswith("."):
        return None
    candidate = (FEATURED_DIR / name).resolve()
    root = FEATURED_DIR.resolve()
    if candidate != root and root in candidate.parents and candidate.is_file():
        return candidate
    return None


@lru_cache(maxsize=1)
def _manifest() -> list[dict]:
    """Load + validate manifest.json once. Entries missing a valid slug or a
    readable in-bounds file are dropped, so the gallery only ever lists items we
    can actually serve. Returns [] when the manifest is absent/broken."""
    try:
        raw = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return []
    entries = raw.get("projects") if isinstance(raw, dict) else None
    if not isinstance(entries, list):
        return []

    clean: list[dict] = []
    seen: set[str] = set()
    for e in entries:
        if not isinstance(e, dict):
            continue
        slug = str(e.get("slug", "")).strip()
        if not _SLUG_RE.match(slug) or slug in seen:
            continue
        if _safe_file(str(e.get("file", ""))) is None:
            continue
        seen.add(slug)
        clean.append(e)
    return clean


def _meta(entry: dict) -> dict:
    """The public metadata for one entry (no HTML). Both language variants are
    sent so the frontend can switch without a round trip."""
    return {
        "slug": entry["slug"],
        "title": entry.get("title", entry["slug"]),
        "title_en": entry.get("title_en", entry.get("title", entry["slug"])),
        "description": entry.get("description", ""),
        "description_en": entry.get("description_en", entry.get("description", "")),
        "provider": entry.get("provider", ""),
    }


def list_featured() -> list[dict]:
    """Ordered metadata for the whole gallery (no HTML — the list view is light;
    HTML is fetched per item on open)."""
    return [_meta(e) for e in _manifest()]


def get_featured(slug: str) -> dict | None:
    """One entry's metadata + its full HTML, or None if the slug is unknown or
    its file has gone missing."""
    if not slug or not _SLUG_RE.match(slug):
        return None
    for e in _manifest():
        if e["slug"] == slug:
            path = _safe_file(str(e.get("file", "")))
            if path is None:
                return None
            try:
                html = path.read_text(encoding="utf-8")
            except OSError:
                return None
            return {**_meta(e), "html": html}
    return None
