"""Featured showcase — a curated gallery of example apps guests can browse.

These are apps we generated ahead of time with the same model pipeline as the
live generator; we persist the finished sources on disk and serve them read-
only. Unlike `projects` (per-user, login-gated), the showcase is PUBLIC: a guest
can open the home page and preview a polished pomodoro timer or a city-switching
travel map without an account — the "come see what this can build" front door.

Storage layout — one directory per app so index.html, style.css and app.js
can be linked with plain relative refs (`<link href="style.css">`):

    featured/
      manifest.json          # ordered list of entries (metadata only)
      pomodoro/
        index.html           # entry file — served at /featured-files/<slug>/
        style.css
        app.js
      city-explorer/
        index.html
        style.css
        app.js

manifest.json shape:
    {
      "projects": [
        {
          "slug": "pomodoro",            # url-safe id; also the directory name
          "title": "…",                   # zh title
          "title_en": "…",                # en title
          "description": "…",             # zh one-liner
          "description_en": "…",          # en one-liner
          "provider": "Nemotron 3 Nano",  # model that produced it (badge)
          "dir": "pomodoro",              # directory INSIDE featured/
          "entry": "index.html"           # optional; defaults to index.html
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

# A slug/dir is our own id namespace; keep it strict so it can never be coerced
# into a path traversal ("../"), an absolute path, or a hidden file. Filenames
# inside a showcase directory follow the same rule so a bad manifest hand-edit
# fails safe instead of leaking files outside featured/<slug>/.
_SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9-]*$")
_FILE_RE = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9._-]*$")

_LANGUAGES = {
    ".html": "html",
    ".htm": "html",
    ".css": "css",
    ".js": "javascript",
    ".mjs": "javascript",
    ".json": "json",
    ".svg": "svg",
    ".txt": "text",
    ".md": "markdown",
}


def _safe_dir(name: str) -> Path | None:
    """Resolve a manifest `dir` to a real directory INSIDE featured/, or None.

    Rejects anything that escapes the directory (``../``, absolute paths,
    symlinked-out targets) by comparing the resolved path against the resolved
    featured dir — so a malformed manifest entry can't read arbitrary paths."""
    if not name or not _SLUG_RE.match(name):
        return None
    candidate = (FEATURED_DIR / name).resolve()
    root = FEATURED_DIR.resolve()
    if candidate != root and root in candidate.parents and candidate.is_dir():
        return candidate
    return None


def _safe_file_in(dir_path: Path, name: str) -> Path | None:
    """Resolve a filename INSIDE a showcase directory, or None.

    Only accepts plain names (no slashes, no dot-prefix); rejects anything that
    escapes the showcase directory via `..` or a symlink target outside root."""
    if not name or not _FILE_RE.match(name):
        return None
    candidate = (dir_path / name).resolve()
    if candidate != dir_path and dir_path in candidate.parents and candidate.is_file():
        return candidate
    return None


@lru_cache(maxsize=1)
def _manifest() -> list[dict]:
    """Load + validate manifest.json once. Entries missing a valid slug or a
    readable in-bounds directory (with the entry file present) are dropped, so
    the gallery only lists items we can actually serve. Returns [] on error."""
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
        dir_name = str(e.get("dir", slug)).strip()
        dir_path = _safe_dir(dir_name)
        if dir_path is None:
            continue
        entry_name = str(e.get("entry", "index.html")).strip() or "index.html"
        if _safe_file_in(dir_path, entry_name) is None:
            continue
        seen.add(slug)
        clean.append({**e, "dir": dir_name, "entry": entry_name})
    return clean


def _meta(entry: dict) -> dict:
    """Public metadata for one entry (no file contents). Both language variants
    ship so the frontend can switch without a round trip."""
    return {
        "slug": entry["slug"],
        "title": entry.get("title", entry["slug"]),
        "title_en": entry.get("title_en", entry.get("title", entry["slug"])),
        "description": entry.get("description", ""),
        "description_en": entry.get("description_en", entry.get("description", "")),
        "provider": entry.get("provider", ""),
    }


def list_featured() -> list[dict]:
    """Ordered metadata for the whole gallery (no file contents)."""
    return [_meta(e) for e in _manifest()]


def _find(slug: str) -> dict | None:
    if not slug or not _SLUG_RE.match(slug):
        return None
    for e in _manifest():
        if e["slug"] == slug:
            return e
    return None


def _language_for(name: str) -> str:
    return _LANGUAGES.get(Path(name).suffix.lower(), "text")


def get_featured(slug: str) -> dict | None:
    """Metadata + every source file in the showcase directory, entry first.

    Files come back as ``[{name, language, content}, ...]`` in stable order:
    the entry (index.html) is always index 0 so the frontend can open it as
    the default tab; the rest follow in sorted order. Returns None if the slug
    is unknown or the directory has been removed."""
    entry = _find(slug)
    if entry is None:
        return None
    dir_path = _safe_dir(entry["dir"])
    if dir_path is None:
        return None

    entry_name = entry["entry"]
    names: list[str] = []
    for p in sorted(dir_path.iterdir()):
        if p.is_file() and _FILE_RE.match(p.name) and p.name != entry_name:
            names.append(p.name)
    ordered = [entry_name, *names]

    files: list[dict] = []
    for name in ordered:
        path = _safe_file_in(dir_path, name)
        if path is None:
            continue
        try:
            content = path.read_text(encoding="utf-8")
        except OSError:
            continue
        files.append({
            "name": name,
            "language": _language_for(name),
            "content": content,
        })
    if not files:
        return None
    return {**_meta(entry), "entry": entry_name, "files": files}


def read_file(slug: str, name: str) -> tuple[Path, str] | None:
    """Resolve one showcase file for the static preview endpoint. Returns the
    absolute path + a MIME-friendly language tag, or None if slug/name don't
    map to a real file inside featured/<slug>/."""
    entry = _find(slug)
    if entry is None:
        return None
    dir_path = _safe_dir(entry["dir"])
    if dir_path is None:
        return None
    path = _safe_file_in(dir_path, name)
    if path is None:
        return None
    return path, _language_for(name)
