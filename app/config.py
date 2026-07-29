"""Central configuration, loaded from environment / .env file.

Model selection (Trae-style)
----------------------------
Instead of a single hard-wired provider, we keep a *registry* of selectable
models. The frontend shows a dropdown; each pick maps to one registry entry that
says which transport to use (OpenAI-compatible or Anthropic), which base URL and
model name to hit, and — crucially — WHICH ENVIRONMENT VARIABLE holds the API key.

API keys never leave the server: the browser only ever sends a model `id`
(e.g. "deepseek-chat"); the key for that id is read from the environment here.

Adding a provider = add a row to MODEL_REGISTRY + set its key env var. No code
elsewhere needs to change. DeepSeek / Doubao (Volcano Ark) / Kimi (Moonshot) are
all OpenAI-compatible, so they reuse the `openai` transport.
"""
import os
from dataclasses import dataclass

from dotenv import load_dotenv

load_dotenv()


def _env_bool(name: str, default: bool) -> bool:
    return os.getenv(name, str(default)).strip().lower() == "true"


@dataclass(frozen=True)
class ModelSpec:
    """One selectable entry in the model dropdown.

    id:          stable key sent by the frontend (never the raw key)
    label:       human-friendly name shown in the dropdown
    transport:   "mock" | "openai" | "anthropic" — how llm.py talks to it
    base_url:    OpenAI-compatible base URL (ignored for mock/anthropic)
    model:       the model name passed to the provider's API
    api_key_env: env var that holds this model's API key ("" for keyless mock)
    free:        whether this is a no-cost option (badge hint in the UI)
    """
    id: str
    label: str
    transport: str
    model: str = ""
    base_url: str = ""
    api_key_env: str = ""
    free: bool = False

    @property
    def api_key(self) -> str:
        return os.getenv(self.api_key_env, "").strip() if self.api_key_env else ""

    @property
    def available(self) -> bool:
        """Keyless transports are always available; keyed ones need their env var."""
        if self.transport == "mock":
            return True
        return bool(self.api_key)


# The catalog of models the UI can offer. Order here = order in the dropdown.
# Only entries whose API key env var is set show up as "available" (see
# available_models()); the keyless `mock` is always present as a safe default.
MODEL_REGISTRY: list[ModelSpec] = [
    ModelSpec(
        id="mock",
        label="Mock (no key)",
        transport="mock",
        free=True,
    ),
    # --- DeepSeek (direct) — OpenAI-compatible -------------------------------
    ModelSpec(
        id="deepseek-chat",
        label="DeepSeek Chat",
        transport="openai",
        model="deepseek-chat",
        base_url="https://api.deepseek.com/v1",
        api_key_env="DEEPSEEK_API_KEY",
    ),
    ModelSpec(
        id="deepseek-reasoner",
        label="DeepSeek Reasoner (R1)",
        transport="openai",
        model="deepseek-reasoner",
        base_url="https://api.deepseek.com/v1",
        api_key_env="DEEPSEEK_API_KEY",
    ),
    # --- Doubao / Volcano Ark — OpenAI-compatible ----------------------------
    # DOUBAO_MODEL can be a model id or an inference endpoint id (ep-xxxxxxxx).
    ModelSpec(
        id="doubao",
        label="Doubao (豆包)",
        transport="openai",
        model=os.getenv("DOUBAO_MODEL", "doubao-seed-1-6-250615"),
        base_url="https://ark.cn-beijing.volces.com/api/v3",
        api_key_env="DOUBAO_API_KEY",
    ),
    # --- Kimi / Moonshot — OpenAI-compatible ---------------------------------
    ModelSpec(
        id="kimi",
        label="Kimi (Moonshot)",
        transport="openai",
        model=os.getenv("MOONSHOT_MODEL", "moonshot-v1-8k"),
        base_url="https://api.moonshot.cn/v1",
        api_key_env="MOONSHOT_API_KEY",
    ),
    # --- OpenRouter free tier — genuinely $0 (great for demos) ---------------
    # NOTE: OpenRouter rotates/retires free slugs often. These were verified
    # against the live /models list; if one 404s ("unavailable for free"),
    # check https://openrouter.ai/models?max_price=0 for a current slug.
    ModelSpec(
        id="openrouter-nemotron-free",
        label="Nemotron 3 Super 120B (OpenRouter free)",
        transport="openai",
        model="nvidia/nemotron-3-super-120b-a12b:free",
        base_url="https://openrouter.ai/api/v1",
        api_key_env="OPENROUTER_API_KEY",
        free=True,
    ),
    ModelSpec(
        id="openrouter-gptoss-free",
        label="GPT-OSS 20B (OpenRouter free)",
        transport="openai",
        model="openai/gpt-oss-20b:free",
        base_url="https://openrouter.ai/api/v1",
        api_key_env="OPENROUTER_API_KEY",
        free=True,
    ),
    # --- Generic OpenAI-compatible (OpenAI / Groq / local / custom) ----------
    # Driven by the classic OPENAI_* vars, so existing setups keep working.
    ModelSpec(
        id="openai",
        label="OpenAI-compatible (custom)",
        transport="openai",
        model=os.getenv("OPENAI_MODEL", "gpt-4o-mini"),
        base_url=os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1"),
        api_key_env="OPENAI_API_KEY",
    ),
    # --- Anthropic (Claude) — premium option ---------------------------------
    ModelSpec(
        id="anthropic",
        label="Claude 3.5 Sonnet",
        transport="anthropic",
        model=os.getenv("ANTHROPIC_MODEL", "claude-3-5-sonnet-20241022"),
        api_key_env="ANTHROPIC_API_KEY",
    ),
]

_REGISTRY_BY_ID = {m.id: m for m in MODEL_REGISTRY}


def get_model(model_id: str | None) -> ModelSpec | None:
    """Look up a registry entry by id. Returns None for unknown ids."""
    if not model_id:
        return None
    return _REGISTRY_BY_ID.get(model_id)


def available_models() -> list[ModelSpec]:
    """Models the UI should offer: those with a configured key, plus keyless mock."""
    return [m for m in MODEL_REGISTRY if m.available]


class Settings:
    # Default model id used when the request doesn't specify one. Falls back to
    # the keyless mock so the app always works out of the box.
    DEFAULT_MODEL_ID: str = os.getenv("DEFAULT_MODEL_ID", "mock")

    # Back-compat: an existing LLM_PROVIDER=openai/anthropic still selects a
    # sensible default model when DEFAULT_MODEL_ID isn't set explicitly.
    LLM_PROVIDER: str = os.getenv("LLM_PROVIDER", "").lower()

    # Legacy single-provider vars — still honored via the "openai"/"anthropic"
    # registry entries above, so prior .env files keep working unchanged.
    OPENAI_API_KEY: str = os.getenv("OPENAI_API_KEY", "")
    OPENAI_BASE_URL: str = os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1")
    OPENAI_MODEL: str = os.getenv("OPENAI_MODEL", "gpt-4o-mini")
    ANTHROPIC_API_KEY: str = os.getenv("ANTHROPIC_API_KEY", "")
    ANTHROPIC_MODEL: str = os.getenv("ANTHROPIC_MODEL", "claude-3-5-sonnet-20241022")

    # If a real provider errors out (bad key, quota, network), fall back to the
    # local mock generator instead of failing the request. Great for live demos.
    LLM_FALLBACK_TO_MOCK: bool = _env_bool("LLM_FALLBACK_TO_MOCK", True)

    APP_NAME: str = "Atoms Demo"

    def default_model_id(self) -> str:
        """Resolve the startup default: explicit DEFAULT_MODEL_ID wins; else map
        a legacy LLM_PROVIDER; else the first available model; else mock."""
        if get_model(self.DEFAULT_MODEL_ID) is not None:
            return self.DEFAULT_MODEL_ID
        if self.LLM_PROVIDER in _REGISTRY_BY_ID:
            return self.LLM_PROVIDER
        avail = available_models()
        return avail[0].id if avail else "mock"


settings = Settings()
