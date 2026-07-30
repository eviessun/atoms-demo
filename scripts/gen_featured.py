"""One-off generator for the featured showcase gallery.

Runs the SAME model pipeline the live app uses (app.llm.generate_app_html) to
produce two polished example apps, splits each one into
featured/<slug>/{index.html, style.css, app.js}, and (re)writes
featured/manifest.json.

Run:  .venv/bin/python scripts/gen_featured.py

Re-runnable: overwrites the split files + manifest each time. Uses the server-
default free model unless GEN_MODEL is set.
"""
from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.config import settings          # noqa: E402
from app.llm import generate_app_html    # noqa: E402

FEATURED_DIR = Path(__file__).resolve().parent.parent / "featured"

_STYLE_RE = re.compile(r"<style>(.*?)</style>", re.DOTALL)
_SCRIPT_RE = re.compile(r"<script>(.*?)</script>", re.DOTALL)


def split_and_write(slug: str, html: str) -> Path:
    """Extract the FIRST inline <style> and <script> blocks into separate files
    and rewrite the entry HTML to link them by relative path. Falls back to a
    single-file layout when either block is missing (still valid — the manifest
    treats index.html as the entry either way)."""
    out_dir = FEATURED_DIR / slug
    out_dir.mkdir(exist_ok=True)

    style_m = _STYLE_RE.search(html)
    script_m = _SCRIPT_RE.search(html)
    entry = html
    if style_m:
        (out_dir / "style.css").write_text(style_m.group(1).strip("\n") + "\n", encoding="utf-8")
        entry = _STYLE_RE.sub('<link rel="stylesheet" href="style.css">', entry, count=1)
    if script_m:
        (out_dir / "app.js").write_text(script_m.group(1).strip("\n") + "\n", encoding="utf-8")
        entry = _SCRIPT_RE.sub('<script src="app.js"></script>', entry, count=1)
    (out_dir / "index.html").write_text(entry, encoding="utf-8")
    return out_dir

# Shared quality bar prepended to every prompt. The preview iframe is sandboxed
# with allow-scripts but NOT allow-same-origin, so Web Storage throws — forbid
# it. Everything must be inline + offline so a guest sees it render instantly.
COMMON = """
Build a single, self-contained, production-quality HTML file. Requirements:
- ALL CSS in one <style> and ALL JS in one <script>; no external files, no CDNs,
  no web fonts, no external images. Use system fonts, CSS, SVG, emoji, or canvas.
- CRITICAL: do NOT use localStorage or sessionStorage (the page runs in a
  sandboxed iframe where Web Storage throws a SecurityError). Keep all state in
  plain JS variables. The app must not crash.
- Beautiful, modern, polished UI: thoughtful color palette, smooth transitions,
  rounded cards, good spacing, clear typography. Responsive down to mobile.
- Fully interactive and genuinely useful — not a stub. No placeholder "TODO".
- Accessible: reasonable contrast, focusable controls, aria-labels on icon buttons.
Output ONLY the raw HTML document. No markdown, no ``` fences, no commentary.
""".strip()

POMODORO = COMMON + "\n\n" + """
Build an excellent Pomodoro focus timer app named "专注番茄钟 / Focus Pomodoro".

Features:
- A large circular countdown ring (SVG) that visually depletes as time passes,
  with the remaining mm:ss in the center.
- Three modes with distinct accent colors: Focus (25:00), Short Break (5:00),
  Long Break (15:00). Tabs to switch modes; switching resets the timer.
- Start / Pause / Reset controls. After 4 completed focus sessions, suggest a
  long break. Show a small "completed pomodoros today" counter (🍅 icons).
- A task list on the side: add a task, mark done (strike-through), delete. The
  current focus session shows which task you're working on (pick the top undone).
- Play a short, pleasant chime using the Web Audio API when a session ends
  (oscillator — NO external audio file). Also flash the ring briefly.
- Settings row to adjust the focus / short / long durations (number inputs in
  minutes) that take effect on the next reset.
Make it feel calm and premium (soft gradient background, subtle shadows).
""".strip()

CITY_MAP = COMMON + "\n\n" + """
Build an excellent travel explorer named "城市漫游 / City Explorer" that switches
the map and tourist attractions when you pick a city.

Include at least 6 cities (mix Chinese + international), e.g. Beijing 北京,
Shanghai 上海, Chengdu 成都, Xi'an 西安, Paris, Tokyo. For EACH city hardcode a
small dataset (all inline in JS): a list of 4-6 famous attractions, each with a
name (bilingual), a short one-sentence description, an emoji icon, a category
(e.g. 历史/自然/美食/艺术), and an (x,y) position on the city's map.

Layout:
- A city selector (a row of pill buttons or a dropdown) at the top.
- A stylized MAP panel drawn with inline SVG (NO external map tiles / no network):
  a soft abstract city map — a river/coast curve, a few road lines, park blocks —
  and a labeled pin for each attraction placed at its (x,y). Give each city a
  slightly different map shape/color so switching is visibly distinct.
- Clicking a pin (or its list item) highlights it on the map and shows a detail
  card: name, category chip, description, and a "★ rating".
- A scrollable ATTRACTIONS list beside the map that updates when the city changes.
- A small header line per city (e.g. "北京 · 6 处景点").
Smooth fade/slide transition when switching cities. Premium, travel-brochure feel
(warm palette, nice cards). Everything inline and offline.
""".strip()

ENTRIES = [
    {
        "slug": "pomodoro",
        "title": "专注番茄钟",
        "title_en": "Focus Pomodoro",
        "description": "带圆环倒计时、任务清单与提示音的番茄工作法计时器。",
        "description_en": "A Pomodoro timer with a circular countdown ring, task list, and chime.",
        "prompt": POMODORO,
    },
    {
        "slug": "city-explorer",
        "title": "城市漫游",
        "title_en": "City Explorer",
        "description": "按城市切换手绘地图与热门旅游景点，点击查看景点详情。",
        "description_en": "Switch hand-drawn maps and top attractions by city; click a pin for details.",
        "prompt": CITY_MAP,
    },
]


def main() -> None:
    FEATURED_DIR.mkdir(exist_ok=True)
    model_id = os.getenv("GEN_MODEL") or settings.default_model_id()
    manifest = {"projects": []}
    for e in ENTRIES:
        print(f"[gen] {e['slug']} via {model_id} …", flush=True)
        html, provider = generate_app_html(e["prompt"], model_id=model_id)
        out_dir = split_and_write(e["slug"], html)
        print(f"      -> {out_dir.name}/{{index.html,style.css,app.js}}"
              f"  ({len(html):,} bytes, provider={provider})")
        manifest["projects"].append({
            "slug": e["slug"], "title": e["title"], "title_en": e["title_en"],
            "description": e["description"], "description_en": e["description_en"],
            "provider": provider, "dir": e["slug"],
        })
    (FEATURED_DIR / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print("[gen] wrote manifest.json with", len(manifest["projects"]), "entries")


if __name__ == "__main__":
    main()
