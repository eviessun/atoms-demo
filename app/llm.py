"""LLM adapter layer.

A single, swappable entry point (`generate_app_html`) that turns a natural-language
request into a self-contained single-file HTML app string. It is driven by a
`ModelSpec` from the registry in `config.py`, so which model runs is decided per
request (the frontend dropdown sends a model id) — not baked in at import time.

Transports (one per `ModelSpec.transport`):
  - mock:      no API key, returns a working demo app (great for building/deploying first)
  - openai:    ANY OpenAI-compatible endpoint (OpenAI, OpenRouter, Groq, DeepSeek,
               Doubao/Volcano Ark, Kimi/Moonshot, local servers, ...). This is the
               "free model" seam — pick a free entry in the dropdown at runtime.
  - anthropic: Claude messages API (premium option)

Adding a model = add a row to MODEL_REGISTRY + set its key env var; this file only
needs a transport handler, which the OpenAI-compatible ones already share.
"""
from __future__ import annotations

import html
import re
import textwrap

import httpx

from .config import ModelSpec, get_model, settings

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

# Used when the user iterates on an already-generated app. We hand the model the
# current HTML plus the change request and ask for the FULL updated document, so
# the agent edits in place instead of starting over.
EDIT_SYSTEM_PROMPT = textwrap.dedent(
    """
    You are an expert web app editor. You are given the current HTML of a
    single-file web app and a change request. Apply the requested change and
    output the COMPLETE updated HTML document.

    Hard rules:
    - Output ONLY raw HTML. No markdown, no ``` fences, no commentary.
    - Preserve everything that still works; change only what the request implies.
    - Keep it a single self-contained file (inline <style> and <script>).
    - The result must still be interactive and work standalone.
    """
).strip()


def _edit_user_content(base_html: str, instruction: str) -> str:
    """Compose the user turn for an edit: current app + the change request."""
    return (
        "Here is the current app HTML:\n\n"
        f"{base_html}\n\n"
        "Apply this change and return the full updated HTML:\n"
        f"{instruction}"
    )


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


def _mock_html(prompt: str, base_html: str | None = None) -> str:
    """A working, self-contained demo app so the full pipeline runs without any
    API key. In edit mode (base_html given) it visibly appends the change to a
    running "change log", so the iterate loop is demonstrable without a real LLM.
    """
    safe = html.escape(prompt)

    # Recover the change log from a prior mock render so edits accumulate.
    history: list[str] = []
    original = safe
    if base_html:
        m = re.search(r'data-mock-original="([^"]*)"', base_html)
        if m:
            original = m.group(1)
        history = re.findall(r'<li class="log-item">(.*?)</li>', base_html)
        history.append(safe)

    log_items = "\n".join(f'<li class="log-item">{h}</li>' for h in history)
    heading = "🧪 Mock preview" if not base_html else "🧪 Mock preview (edited)"
    intro = (
        f'<p>Your request was: <span class="req">&ldquo;{original}&rdquo;</span></p>'
        if not base_html
        else f'<p>Original request: <span class="req">&ldquo;{original}&rdquo;</span></p>'
        f'<p>Latest change: <span class="req">&ldquo;{safe}&rdquo;</span></p>'
    )
    log_block = (
        f'<div class="card"><h2>Change log ({len(history)})</h2>'
        f'<ol class="log">{log_items}</ol></div>'
        if history
        else ""
    )

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
            h2 {{ font-size: 1rem; color: #94a3b8; margin: 0 0 8px; }}
            .card {{ background: #1e293b; border-radius: 12px; padding: 20px; margin-top: 16px; }}
            .req {{ color: #38bdf8; font-style: italic; }}
            .log {{ margin: 0; padding-left: 20px; }}
            .log-item {{ margin: 4px 0; }}
            button {{ background: #38bdf8; border: 0; color: #0f172a; padding: 10px 16px;
                     border-radius: 8px; font-weight: 600; cursor: pointer; }}
            #count {{ font-size: 2rem; font-weight: 700; margin: 12px 0; }}
          </style>
        </head>
        <body data-mock-original="{original}">
          <div class="wrap">
            <h1>{heading}</h1>
            <div class="card">
              <p>This placeholder renders because <code>LLM_PROVIDER=mock</code>.</p>
              {intro}
              <p>Once a real LLM key is configured, this area shows the generated app.</p>
              <div id="count">0</div>
              <button onclick="document.getElementById('count').textContent=++window.n||1">
                Click me (interactive test)
              </button>
            </div>
            {log_block}
          </div>
          <script>window.n = 0;</script>
        </body>
        </html>
        """
    ).strip()


def _openai_html(spec: ModelSpec, prompt: str, base_html: str | None = None) -> str:
    headers = {"Authorization": f"Bearer {spec.api_key}"}
    # OpenRouter (a common free-tier gateway) recommends these; harmless elsewhere.
    if "openrouter.ai" in spec.base_url:
        headers["HTTP-Referer"] = "https://atoms-demo-lted.onrender.com"
        headers["X-Title"] = settings.APP_NAME
    if base_html:
        messages = [
            {"role": "system", "content": EDIT_SYSTEM_PROMPT},
            {"role": "user", "content": _edit_user_content(base_html, prompt)},
        ]
    else:
        messages = [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": prompt},
        ]
    resp = httpx.post(
        f"{spec.base_url}/chat/completions",
        headers=headers,
        json={
            "model": spec.model,
            "messages": messages,
            "temperature": 0.7,
        },
        timeout=120,
    )
    resp.raise_for_status()
    return _strip_code_fences(resp.json()["choices"][0]["message"]["content"])


def _anthropic_html(spec: ModelSpec, prompt: str, base_html: str | None = None) -> str:
    system = EDIT_SYSTEM_PROMPT if base_html else SYSTEM_PROMPT
    user = _edit_user_content(base_html, prompt) if base_html else prompt
    resp = httpx.post(
        "https://api.anthropic.com/v1/messages",
        headers={
            "x-api-key": spec.api_key,
            "anthropic-version": "2023-06-01",
        },
        json={
            "model": spec.model,
            "max_tokens": 4096,
            "system": system,
            "messages": [{"role": "user", "content": user}],
        },
        timeout=120,
    )
    resp.raise_for_status()
    return _strip_code_fences(resp.json()["content"][0]["text"])


def _generate_with_spec(spec: ModelSpec, prompt: str, base_html: str | None = None) -> str:
    if spec.transport == "openai":
        return _openai_html(spec, prompt, base_html)
    if spec.transport == "anthropic":
        return _anthropic_html(spec, prompt, base_html)
    # default / "mock": no key required
    return _mock_html(prompt, base_html)


def generate_app_html(
    prompt: str, base_html: str | None = None, model_id: str | None = None
) -> tuple[str, str]:
    """Turn a request into HTML. Returns (html, model_label_actually_used).

    `model_id` selects a registry entry (from the frontend dropdown). If it's
    missing or unknown, we fall back to the configured default model.

    If base_html is given, the model edits that app in place (iterate loop);
    otherwise it builds a new app from scratch.

    If the selected model is configured but fails (bad key, quota, network), and
    LLM_FALLBACK_TO_MOCK is on, we degrade to the mock generator instead of
    failing the request — so live demos never hard-error on the core action.
    """
    spec = get_model(model_id) or get_model(settings.default_model_id())
    # Guard against a model whose key isn't actually set (e.g. stale client pick).
    if spec is None or not spec.available:
        spec = get_model("mock")

    try:
        return _generate_with_spec(spec, prompt, base_html), spec.label
    except Exception:
        if spec.transport != "mock" and settings.LLM_FALLBACK_TO_MOCK:
            return _mock_html(prompt, base_html), f"{spec.label} → Mock (fallback)"
        raise
