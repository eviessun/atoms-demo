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
import json
import re
import textwrap
import time

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


# --- multimodal helpers ---------------------------------------------------
# Images arrive from the frontend as data URLs ("data:image/png;base64,AAAA...").
# A text-only request keeps message content as a plain string (unchanged wire
# format); only when there are images do we switch to the provider's structured
# content list. The two providers want different shapes, hence two builders.

def _parse_data_url(data_url: str) -> tuple[str, str] | None:
    """Split a data URL into (media_type, base64_payload). Returns None if it
    isn't a base64 data URL we can forward (so we simply drop it)."""
    m = re.match(r"data:([^;,]+);base64,(.*)$", (data_url or "").strip(), re.DOTALL)
    if not m:
        return None
    return m.group(1), m.group(2)


def _openai_user_content(text: str, images: list[str] | None):
    """Build the OpenAI-compatible user content. Plain string when there are no
    images; otherwise a [text, image_url...] list (the format GPT-4o / Gemma /
    Doubao vision expect). Data URLs are passed straight through as image_url."""
    if not images:
        return text
    parts: list[dict] = [{"type": "text", "text": text}]
    for url in images:
        if _parse_data_url(url):  # only forward well-formed base64 data URLs
            parts.append({"type": "image_url", "image_url": {"url": url}})
    return parts


def _anthropic_user_content(text: str, images: list[str] | None):
    """Build the Anthropic user content. Plain string when there are no images;
    otherwise a list of blocks with base64 image sources (Claude's format)."""
    if not images:
        return text
    blocks: list[dict] = [{"type": "text", "text": text}]
    for url in images:
        parsed = _parse_data_url(url)
        if parsed:
            media_type, data = parsed
            blocks.append({
                "type": "image",
                "source": {"type": "base64", "media_type": media_type, "data": data},
            })
    return blocks


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


def _openai_html(
    spec: ModelSpec, prompt: str, base_html: str | None = None,
    images: list[str] | None = None,
) -> str:
    headers = {"Authorization": f"Bearer {spec.api_key}"}
    # OpenRouter (a common free-tier gateway) recommends these; harmless elsewhere.
    if "openrouter.ai" in spec.base_url:
        headers["HTTP-Referer"] = "https://atoms-demo-lted.onrender.com"
        headers["X-Title"] = settings.APP_NAME
    text = _edit_user_content(base_html, prompt) if base_html else prompt
    system = EDIT_SYSTEM_PROMPT if base_html else SYSTEM_PROMPT
    messages = [
        {"role": "system", "content": system},
        {"role": "user", "content": _openai_user_content(text, images)},
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


def _anthropic_html(
    spec: ModelSpec, prompt: str, base_html: str | None = None,
    images: list[str] | None = None,
) -> str:
    system = EDIT_SYSTEM_PROMPT if base_html else SYSTEM_PROMPT
    text = _edit_user_content(base_html, prompt) if base_html else prompt
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
            "messages": [{"role": "user", "content": _anthropic_user_content(text, images)}],
        },
        timeout=120,
    )
    resp.raise_for_status()
    return _strip_code_fences(resp.json()["content"][0]["text"])


def _generate_with_spec(
    spec: ModelSpec, prompt: str, base_html: str | None = None,
    images: list[str] | None = None,
) -> str:
    # Only forward images to a vision-capable model; otherwise drop them so a
    # stale client pick can't send images to a text-only endpoint (which some
    # providers reject with a hard error).
    imgs = images if (images and spec.vision) else None
    if spec.transport == "openai":
        return _openai_html(spec, prompt, base_html, imgs)
    if spec.transport == "anthropic":
        return _anthropic_html(spec, prompt, base_html, imgs)
    # default / "mock": no key required
    return _mock_html(prompt, base_html)


def generate_app_html(
    prompt: str,
    base_html: str | None = None,
    model_id: str | None = None,
    spec: ModelSpec | None = None,
    images: list[str] | None = None,
) -> tuple[str, str]:
    """Turn a request into HTML. Returns (html, model_label_actually_used).

    `spec`, when given, is used directly (BYOK: a transient spec carrying the
    user's inline key). Otherwise `model_id` selects a registry entry (from the
    frontend dropdown); if it's missing or unknown, we fall back to the
    configured default model.

    If base_html is given, the model edits that app in place (iterate loop);
    otherwise it builds a new app from scratch.

    `images` (base64 data URLs) are forwarded only to vision-capable specs; the
    mock/fallback path ignores them.

    If a *server-configured* model fails (bad key, quota, network) and
    LLM_FALLBACK_TO_MOCK is on, we degrade to the mock generator instead of
    failing the request — so live demos never hard-error on the core action.
    BYOK is exempt: a user testing their own key needs to see the real error.
    """
    byok = spec is not None
    if spec is None:
        spec = get_model(model_id) or get_model(settings.default_model_id())
        # Guard against a model whose key isn't actually set (e.g. stale client pick).
        if spec is None or not spec.available:
            spec = get_model("mock")

    try:
        return _generate_with_spec(spec, prompt, base_html, images), spec.label
    except Exception:
        # Surface BYOK errors verbatim (the user is debugging their own key);
        # only auto-degrade for server-managed models.
        if not byok and spec.transport != "mock" and settings.LLM_FALLBACK_TO_MOCK:
            return _mock_html(prompt, base_html), f"{spec.label} → Mock (fallback)"
        raise


# --- streaming -----------------------------------------------------------
# The blocking path above returns the whole HTML at once, which hides the
# model's "thinking" and the code being written — the user just waits. The
# streaming twins below yield incremental events so the UI can show reasoning
# and code as they arrive. Events are simple tuples: (kind, payload) where kind
# is one of: "model" | "reasoning" | "content" | "done" | "error".


def _openai_stream(
    spec: ModelSpec, prompt: str, base_html: str | None = None,
    images: list[str] | None = None,
):
    """Yield ('reasoning', delta) / ('content', delta) from an SSE chat stream.

    Reasoning models expose their chain-of-thought in delta.reasoning
    (OpenRouter) or delta.reasoning_content (DeepSeek R1); regular content
    arrives in delta.content. We surface both."""
    headers = {"Authorization": f"Bearer {spec.api_key}"}
    if "openrouter.ai" in spec.base_url:
        headers["HTTP-Referer"] = "https://atoms-demo-lted.onrender.com"
        headers["X-Title"] = settings.APP_NAME
    text = _edit_user_content(base_html, prompt) if base_html else prompt
    system = EDIT_SYSTEM_PROMPT if base_html else SYSTEM_PROMPT
    messages = [
        {"role": "system", "content": system},
        {"role": "user", "content": _openai_user_content(text, images)},
    ]
    with httpx.stream(
        "POST",
        f"{spec.base_url}/chat/completions",
        headers=headers,
        json={
            "model": spec.model,
            "messages": messages,
            "temperature": 0.7,
            "stream": True,
        },
        timeout=httpx.Timeout(120.0, read=None),
    ) as resp:
        resp.raise_for_status()
        for line in resp.iter_lines():
            if not line or line.startswith(":"):
                continue  # blank / comment (heartbeat) lines
            if not line.startswith("data:"):
                continue
            data = line[5:].strip()
            if data == "[DONE]":
                break
            try:
                obj = json.loads(data)
            except json.JSONDecodeError:
                continue
            choices = obj.get("choices") or []
            if not choices:
                continue
            delta = choices[0].get("delta") or {}
            reasoning = delta.get("reasoning") or delta.get("reasoning_content")
            if reasoning:
                yield ("reasoning", reasoning)
            content = delta.get("content")
            if content:
                yield ("content", content)


def _simulate_stream(full_html: str, chunk: int = 60, delay: float = 0.02):
    """Chunk an already-produced HTML string into ('content', piece) events, so
    keyless mock / non-streaming transports still animate in the UI."""
    for i in range(0, len(full_html), chunk):
        yield ("content", full_html[i : i + chunk])
        time.sleep(delay)


def stream_app_html(
    prompt: str,
    base_html: str | None = None,
    model_id: str | None = None,
    spec: ModelSpec | None = None,
    images: list[str] | None = None,
):
    """Streaming twin of generate_app_html. Yields (kind, payload) events:
      ("model", label)      once, first — the model actually used
      ("reasoning", delta)  0+ times — chain-of-thought tokens
      ("content", delta)    0+ times — raw HTML chunks (NOT fence-stripped)
      ("done", html)        once, last — the cleaned, complete HTML
      ("error", message)    on hard failure (fallback disabled / BYOK)

    Mirrors generate_app_html's spec resolution and graceful mock fallback
    (BYOK errors surface verbatim), but streams instead of returning a blob.
    `images` (base64 data URLs) are forwarded only to vision-capable specs."""
    byok = spec is not None
    if spec is None:
        spec = get_model(model_id) or get_model(settings.default_model_id())
        if spec is None or not spec.available:
            spec = get_model("mock")

    def _source(s: ModelSpec):
        """Pick a per-transport event stream for spec `s`."""
        # Only forward images to a vision-capable model (see _generate_with_spec).
        imgs = images if (images and s.vision) else None
        if s.transport == "openai":
            return _openai_stream(s, prompt, base_html, imgs)
        if s.transport == "anthropic":
            return _simulate_stream(_anthropic_html(s, prompt, base_html, imgs))
        return _simulate_stream(_mock_html(prompt, base_html))

    acc: list[str] = []
    yield ("model", spec.label)
    try:
        for kind, payload in _source(spec):
            if kind == "content":
                acc.append(payload)
            yield (kind, payload)
    except Exception as exc:  # noqa: BLE001
        # BYOK: surface the real error so the user can fix their own key.
        # Server-managed models degrade to mock when enabled.
        if not byok and spec.transport != "mock" and settings.LLM_FALLBACK_TO_MOCK:
            acc = []  # drop the partial failed stream
            yield ("model", f"{spec.label} → Mock (fallback)")
            for kind, payload in _simulate_stream(_mock_html(prompt, base_html)):
                if kind == "content":
                    acc.append(payload)
                yield (kind, payload)
        else:
            yield ("error", str(exc))
            return

    yield ("done", _strip_code_fences("".join(acc)))
