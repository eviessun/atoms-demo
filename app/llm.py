"""LLM adapter layer.

A single, swappable entry point (`generate_app_html`) that turns a natural-language
request into a self-contained single-file HTML app string. Switching providers only
touches this file — the rest of the app calls `generate_app_html` regardless of backend.

Providers:
  - mock:      no API key, returns a working demo app (great for building/deploying first)
  - openai:    OpenAI-compatible chat completions
  - anthropic: Claude messages API
  - atoms:     placeholder — wire up once the endpoint/format is known
"""
from __future__ import annotations

import html
import textwrap

import httpx

from .config import settings

# The system prompt that instructs the model to output ONE self-contained HTML file.
SYSTEM_PROMPT = textwrap.dedent(
    """
    You are an expert web app generator. Given a user's request, output ONE
    self-contained HTML document that fully implements the requested app.

    Hard rules:
    - Output ONLY raw HTML. No markdown, no ``` fences, no commentary.
    - Everything inline: CSS in a <style> tag, JS in a <script> tag. No external files.
    - The app must be interactive and actually work when opened standalone.
    - Keep it clean and visually pleasant. Mobile-friendly where reasonable.
    """
).strip()


def _strip_code_fences(text: str) -> str:
    """Some models wrap output in ```html ... ``` despite instructions."""
    t = text.strip()
    if t.startswith("```"):
        first_newline = t.find("\n")
        if first_newline != -1:
            t = t[first_newline + 1 :]
        if t.rstrip().endswith("```"):
            t = t.rstrip()[:-3]
    return t.strip()


def _mock_html(prompt: str) -> str:
    """A working, self-contained demo app so the full pipeline runs without any API key."""
    safe = html.escape(prompt)
    return textwrap.dedent(
        f"""
        <!doctype html>
        <html lang="en">
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <title>Generated App (mock)</title>
          <style>
            body {{ font-family: system-ui, sans-serif; margin: 0; background: #0f172a; color: #e2e8f0; }}
            .wrap {{ max-width: 640px; margin: 8vh auto; padding: 24px; }}
            h1 {{ font-size: 1.4rem; }}
            .card {{ background: #1e293b; border-radius: 12px; padding: 20px; margin-top: 16px; }}
            .req {{ color: #38bdf8; font-style: italic; }}
            button {{ background: #38bdf8; border: 0; color: #0f172a; padding: 10px 16px;
                     border-radius: 8px; font-weight: 600; cursor: pointer; }}
            #count {{ font-size: 2rem; font-weight: 700; margin: 12px 0; }}
          </style>
        </head>
        <body>
          <div class="wrap">
            <h1>🧪 Mock preview</h1>
            <div class="card">
              <p>This placeholder renders because <code>LLM_PROVIDER=mock</code>.</p>
              <p>Your request was: <span class="req">&ldquo;{safe}&rdquo;</span></p>
              <p>Once a real LLM key is configured, this area shows the generated app.</p>
              <div id="count">0</div>
              <button onclick="document.getElementById('count').textContent=++window.n||1">
                Click me (interactive test)
              </button>
            </div>
          </div>
          <script>window.n = 0;</script>
        </body>
        </html>
        """
    ).strip()


def _openai_html(prompt: str) -> str:
    resp = httpx.post(
        f"{settings.OPENAI_BASE_URL}/chat/completions",
        headers={"Authorization": f"Bearer {settings.OPENAI_API_KEY}"},
        json={
            "model": settings.OPENAI_MODEL,
            "messages": [
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": prompt},
            ],
            "temperature": 0.7,
        },
        timeout=120,
    )
    resp.raise_for_status()
    return _strip_code_fences(resp.json()["choices"][0]["message"]["content"])


def _anthropic_html(prompt: str) -> str:
    resp = httpx.post(
        "https://api.anthropic.com/v1/messages",
        headers={
            "x-api-key": settings.ANTHROPIC_API_KEY,
            "anthropic-version": "2023-06-01",
        },
        json={
            "model": settings.ANTHROPIC_MODEL,
            "max_tokens": 4096,
            "system": SYSTEM_PROMPT,
            "messages": [{"role": "user", "content": prompt}],
        },
        timeout=120,
    )
    resp.raise_for_status()
    return _strip_code_fences(resp.json()["content"][0]["text"])


def generate_app_html(prompt: str) -> str:
    """Turn a natural-language request into a self-contained HTML app string."""
    provider = settings.LLM_PROVIDER
    if provider == "openai":
        return _openai_html(prompt)
    if provider == "anthropic":
        return _anthropic_html(prompt)
    if provider == "atoms":
        # TODO: wire up once the Atoms endpoint/format is known (likely OpenAI-compatible).
        raise NotImplementedError("Atoms provider not configured yet.")
    # default: mock (no key required)
    return _mock_html(prompt)
