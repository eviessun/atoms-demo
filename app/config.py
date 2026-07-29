"""Central configuration, loaded from environment / .env file."""
import os

from dotenv import load_dotenv

load_dotenv()


class Settings:
    # LLM provider selection: mock | openai | anthropic
    #   mock   -> no key, local placeholder generator (default, keeps deploy green)
    #   openai -> ANY OpenAI-compatible endpoint. This is the "free model" seam:
    #             point OPENAI_BASE_URL/OPENAI_MODEL at a free provider (OpenRouter
    #             free tier, Groq, a local model, ...) or at real OpenAI later.
    #   anthropic -> Claude messages API
    LLM_PROVIDER: str = os.getenv("LLM_PROVIDER", "mock").lower()

    # OpenAI-compatible (covers OpenAI, OpenRouter, Groq, local servers, etc.)
    # Free-model example (OpenRouter):
    #   OPENAI_BASE_URL=https://openrouter.ai/api/v1
    #   OPENAI_MODEL=meta-llama/llama-3.1-8b-instruct:free
    # Upgrade later by swapping these to gpt-4o / etc. — no code change.
    OPENAI_API_KEY: str = os.getenv("OPENAI_API_KEY", "")
    OPENAI_BASE_URL: str = os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1")
    OPENAI_MODEL: str = os.getenv("OPENAI_MODEL", "gpt-4o-mini")

    # Anthropic (premium option for later)
    ANTHROPIC_API_KEY: str = os.getenv("ANTHROPIC_API_KEY", "")
    ANTHROPIC_MODEL: str = os.getenv("ANTHROPIC_MODEL", "claude-3-5-sonnet-20241022")

    # If a real provider errors out (bad key, quota, network), fall back to the
    # local mock generator instead of failing the request. Great for live demos.
    LLM_FALLBACK_TO_MOCK: bool = os.getenv("LLM_FALLBACK_TO_MOCK", "true").lower() == "true"

    APP_NAME: str = "Atoms Demo"


settings = Settings()
