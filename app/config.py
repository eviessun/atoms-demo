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
    hidden:      keep it selectable/resolvable server-side but off the UI dropdown
                 (e.g. mock stays as the fallback/degrade target without being an
                 offered choice — see available_models() and default_model_id()).
    vision:      whether the model accepts image input. The UI enables the image
                 attach button only for vision models and greys it out otherwise;
                 the server also skips attaching images for a non-vision spec so a
                 stale client pick can't send images to a text-only model.
    """
    id: str
    label: str
    transport: str
    model: str = ""
    base_url: str = ""
    api_key_env: str = ""
    free: bool = False
    hidden: bool = False
    vision: bool = False
    # BYOK ("bring your own key"): a placeholder entry the UI always offers. The
    # real transport/model/base_url/key arrive per-request from the browser and
    # are used transiently — never read from the environment, never persisted.
    byok: bool = False
    # An inline key supplied per-request (BYOK). When set it wins over api_key_env
    # so we never need to stash a user's key in the environment.
    inline_key: str = ""

    @property
    def api_key(self) -> str:
        if self.inline_key:
            return self.inline_key
        return os.getenv(self.api_key_env, "").strip() if self.api_key_env else ""

    @property
    def available(self) -> bool:
        """Keyless transports are always available; keyed ones need their env var.
        BYOK is always offered (the key comes from the request, not the server)."""
        if self.transport == "mock" or self.byok:
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
        # Kept as the always-available fallback/degrade target (see llm.py) and
        # the offline test/dev default, but hidden from the UI dropdown so users
        # only see real models. Still resolvable via get_model("mock").
        hidden=True,
    ),
    # --- BYOK: user brings their own key, entered in the browser -------------
    # Always offered. The key/model/base_url arrive with each request and are
    # used transiently — never stored on the server. Lets anyone plug in a
    # big-name model (DeepSeek / Doubao / Kimi / OpenAI / ...) with their own key.
    ModelSpec(
        id="byok",
        label="自定义（自备 Key）",
        transport="openai",
        byok=True,
        # The user picks their own model, so we can't know its modality up front.
        # Offer the image attach button and let their provider accept or reject
        # the images — same "surface the real error" philosophy as BYOK keys.
        vision=True,
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
        vision=True,  # doubao-seed-1.6 accepts image input
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
    # Verified live against OpenRouter's /models list. If a slug ever 404s
    # ("unavailable for free"), grab a current one from
    # https://openrouter.ai/models?max_price=0.
    # Nano 30B leads the group: it's the fastest/most-stable free slug in
    # testing, so it's both the top dropdown pick and the auto-selected default.
    ModelSpec(
        id="openrouter-nemotron-nano-free",
        label="Nemotron 3 Nano 30B",
        transport="openai",
        model="nvidia/nemotron-3-nano-30b-a3b:free",
        base_url="https://openrouter.ai/api/v1",
        api_key_env="OPENROUTER_API_KEY",
        free=True,
    ),
    ModelSpec(
        id="openrouter-nemotron-free",
        label="Nemotron 3 Super 120B",
        transport="openai",
        model="nvidia/nemotron-3-super-120b-a12b:free",
        base_url="https://openrouter.ai/api/v1",
        api_key_env="OPENROUTER_API_KEY",
        free=True,
    ),
    ModelSpec(
        id="openrouter-gptoss-free",
        label="GPT-OSS 20B",
        transport="openai",
        model="openai/gpt-oss-20b:free",
        base_url="https://openrouter.ai/api/v1",
        api_key_env="OPENROUTER_API_KEY",
        free=True,
    ),
    ModelSpec(
        id="openrouter-nemotron-ultra-free",
        label="Nemotron 3 Ultra 550B",
        transport="openai",
        model="nvidia/nemotron-3-ultra-550b-a55b:free",
        base_url="https://openrouter.ai/api/v1",
        api_key_env="OPENROUTER_API_KEY",
        free=True,
    ),
    ModelSpec(
        id="openrouter-gemma-free",
        label="Gemma 4 31B",
        transport="openai",
        model="google/gemma-4-31b-it:free",
        base_url="https://openrouter.ai/api/v1",
        api_key_env="OPENROUTER_API_KEY",
        free=True,
        vision=True,  # Gemma -it multimodal variants accept images
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
        vision=True,  # gpt-4o / 4o-mini are vision-capable
    ),
    # --- Anthropic (Claude) — premium option ---------------------------------
    ModelSpec(
        id="anthropic",
        label="Claude 3.5 Sonnet",
        transport="anthropic",
        model=os.getenv("ANTHROPIC_MODEL", "claude-3-5-sonnet-20241022"),
        api_key_env="ANTHROPIC_API_KEY",
        vision=True,  # Claude 3.5 Sonnet accepts images
    ),
]

_REGISTRY_BY_ID = {m.id: m for m in MODEL_REGISTRY}


def get_model(model_id: str | None) -> ModelSpec | None:
    """Look up a registry entry by id. Returns None for unknown ids."""
    if not model_id:
        return None
    return _REGISTRY_BY_ID.get(model_id)


def available_models() -> list[ModelSpec]:
    """Models the UI should offer: those with a configured key, minus any
    marked `hidden` (e.g. mock, which stays as a server-side fallback but isn't
    an offered choice)."""
    return [m for m in MODEL_REGISTRY if m.available and not m.hidden]


# BYOK presets shown in the "自定义（自备 Key）" dialog. Each fills in the
# transport + base URL + a sensible default model name for a well-known
# provider, so the user only has to paste a key (and optionally tweak the
# model). `transport` is "openai" (OpenAI-compatible) or "anthropic".
# NOTE: these are hints for the UI only; the server validates the final values.
BYOK_PRESETS: list[dict] = [
    {"id": "deepseek", "label": "DeepSeek", "transport": "openai",
     "base_url": "https://api.deepseek.com/v1", "model": "deepseek-chat",
     "key_hint": "sk-...", "docs": "https://platform.deepseek.com/api_keys"},
    {"id": "doubao", "label": "豆包 / 火山方舟", "transport": "openai",
     "base_url": "https://ark.cn-beijing.volces.com/api/v3", "model": "doubao-seed-1-6-250615",
     "key_hint": "火山方舟 API Key", "docs": "https://console.volcengine.com/ark"},
    {"id": "kimi", "label": "Kimi / Moonshot", "transport": "openai",
     "base_url": "https://api.moonshot.cn/v1", "model": "moonshot-v1-8k",
     "key_hint": "sk-...", "docs": "https://platform.moonshot.cn/console/api-keys"},
    {"id": "openrouter", "label": "OpenRouter", "transport": "openai",
     "base_url": "https://openrouter.ai/api/v1", "model": "deepseek/deepseek-chat",
     "key_hint": "sk-or-v1-...", "docs": "https://openrouter.ai/keys"},
    {"id": "openai", "label": "OpenAI", "transport": "openai",
     "base_url": "https://api.openai.com/v1", "model": "gpt-4o-mini",
     "key_hint": "sk-...", "docs": "https://platform.openai.com/api-keys"},
    {"id": "anthropic", "label": "Claude / Anthropic", "transport": "anthropic",
     "base_url": "https://api.anthropic.com/v1", "model": "claude-3-5-sonnet-20241022",
     "key_hint": "sk-ant-...", "docs": "https://console.anthropic.com/settings/keys"},
    {"id": "custom", "label": "自定义 (OpenAI 兼容)", "transport": "openai",
     "base_url": "", "model": "", "key_hint": "your key",
     "docs": ""},
]


def build_byok_spec(
    api_key: str, model: str, base_url: str = "", transport: str = "openai"
) -> ModelSpec:
    """Build a transient ModelSpec from a per-request BYOK payload.

    The key is carried on the spec's `inline_key` (used once, never persisted or
    written to the environment). transport is normalized to openai/anthropic.
    """
    t = "anthropic" if transport == "anthropic" else "openai"
    return ModelSpec(
        id="byok",
        label="自定义（自备 Key）",
        transport=t,
        model=(model or "").strip(),
        base_url=(base_url or "").strip().rstrip("/"),
        byok=True,
        vision=True,  # user-chosen model; let their provider judge the images
        inline_key=(api_key or "").strip(),
    )


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
        """Resolve the startup default the UI should preselect.

        Prefer an explicit DEFAULT_MODEL_ID (or legacy LLM_PROVIDER) when it
        names a model that's actually offered — available AND not hidden.
        Otherwise fall to the first offered model. Only when nothing is offered
        (no keys set, e.g. tests / offline dev) do we return the hidden `mock`,
        so the app still works out of the box.

        This is why prod stops defaulting to mock even if its DEFAULT_MODEL_ID
        env var still says "mock": mock is hidden, so once a real key is set the
        default auto-advances to a real model — no env-var edit required."""
        for candidate in (self.DEFAULT_MODEL_ID, self.LLM_PROVIDER):
            spec = get_model(candidate)
            if spec is not None and spec.available and not spec.hidden and not spec.byok:
                return candidate
        # First real, ready-to-use model: skip BYOK (needs user-supplied creds).
        for m in available_models():
            if not m.byok:
                return m.id
        return "mock"


settings = Settings()
