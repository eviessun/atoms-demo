"""Multimodal image input: request sanitizing, vision gating, and the
provider content builders.

The offline mock model can't "see" images, so these tests split into two
layers:
  * API layer — /api/models exposes `vision`; /api/generate accepts an
    `images` payload without breaking the mock path.
  * Unit layer — the sanitizer caps/filters data URLs, the content builders
    emit the right provider shapes, and _generate_with_spec only forwards
    images to a vision-capable spec.
"""
import dataclasses

from app import llm
from app.config import get_model
from app.main import _sanitize_images, MAX_IMAGES
from .conftest import register, generate

# A well-formed (if short) base64 data URL — DATA_URL_RE only checks the
# prefix, and the content builders only need a parseable media type + payload.
IMG = "data:image/png;base64,AAAABBBBCCCC"


# --- API layer ----------------------------------------------------------

def test_models_endpoint_exposes_vision_flag(client):
    models = client.get("/api/models").json()["models"]
    assert models, "expected at least the mock model"
    # Every entry carries a boolean `vision` capability flag.
    for m in models:
        assert "vision" in m
        assert isinstance(m["vision"], bool)


def test_generate_accepts_images_payload_on_mock(client):
    # The mock model ignores images, but sending them must not break the path.
    register(client)
    resp = generate(client, "a gallery", images=[IMG])
    assert resp.status_code == 200, resp.text
    assert resp.json()["html"]


def test_generate_tolerates_malformed_images(client):
    # Non-data-URL strings are sanitized away server-side; still a clean 200.
    # (Non-string items are rejected earlier by Pydantic's list[str] schema.)
    register(client)
    resp = generate(client, "a gallery", images=["not-a-data-url", ""])
    assert resp.status_code == 200, resp.text


# --- sanitizer ----------------------------------------------------------

def test_sanitize_images_filters_and_caps():
    assert _sanitize_images(None) == []
    assert _sanitize_images([]) == []
    # Drops non-strings and non-data-URLs, keeps well-formed ones.
    assert _sanitize_images([IMG, "nope", 42, None]) == [IMG]
    # Caps at MAX_IMAGES.
    many = [IMG] * (MAX_IMAGES + 3)
    assert len(_sanitize_images(many)) == MAX_IMAGES


# --- provider content builders -----------------------------------------

def test_openai_user_content_plain_when_no_images():
    assert llm._openai_user_content("hi", None) == "hi"
    assert llm._openai_user_content("hi", []) == "hi"


def test_openai_user_content_builds_parts():
    parts = llm._openai_user_content("hi", [IMG])
    assert parts[0] == {"type": "text", "text": "hi"}
    assert parts[1]["type"] == "image_url"
    assert parts[1]["image_url"]["url"] == IMG


def test_anthropic_user_content_builds_blocks():
    blocks = llm._anthropic_user_content("hi", [IMG])
    assert blocks[0] == {"type": "text", "text": "hi"}
    src = blocks[1]["source"]
    assert src["type"] == "base64"
    assert src["media_type"] == "image/png"
    assert src["data"] == "AAAABBBBCCCC"


def test_content_builders_drop_bad_urls():
    # A malformed URL is silently skipped, leaving only the text part.
    assert llm._openai_user_content("hi", ["nope"]) == [{"type": "text", "text": "hi"}]
    assert llm._anthropic_user_content("hi", ["nope"]) == [{"type": "text", "text": "hi"}]


# --- vision gating in _generate_with_spec -------------------------------

def test_generate_with_spec_gates_images_by_vision(monkeypatch):
    """Images reach an openai call only when the spec is vision-capable."""
    seen = {}

    def fake_openai_html(spec, prompt, base_html, images=None):
        seen["images"] = images
        return "<html></html>"

    monkeypatch.setattr(llm, "_openai_html", fake_openai_html)

    base = get_model("mock")
    vision_spec = dataclasses.replace(base, transport="openai", vision=True)
    text_spec = dataclasses.replace(base, transport="openai", vision=False)

    llm._generate_with_spec(vision_spec, "p", None, [IMG])
    assert seen["images"] == [IMG]           # forwarded to a vision model

    llm._generate_with_spec(text_spec, "p", None, [IMG])
    assert seen["images"] is None            # dropped for a text-only model
