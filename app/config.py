"""Central configuration, loaded from environment / .env file."""
import os

from dotenv import load_dotenv

load_dotenv()


class Settings:
    # LLM provider selection: mock | openai | anthropic | atoms
    LLM_PROVIDER: str = os.getenv("LLM_PROVIDER", "mock").lower()

    # OpenAI-compatible
    OPENAI_API_KEY: str = os.getenv("OPENAI_API_KEY", "")
    OPENAI_BASE_URL: str = os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1")
    OPENAI_MODEL: str = os.getenv("OPENAI_MODEL", "gpt-4o-mini")

    # Anthropic
    ANTHROPIC_API_KEY: str = os.getenv("ANTHROPIC_API_KEY", "")
    ANTHROPIC_MODEL: str = os.getenv("ANTHROPIC_MODEL", "claude-3-5-sonnet-20241022")

    # Atoms (to be filled in once the endpoint/format is known)
    ATOMS_API_KEY: str = os.getenv("ATOMS_API_KEY", "")
    ATOMS_BASE_URL: str = os.getenv("ATOMS_BASE_URL", "")
    ATOMS_MODEL: str = os.getenv("ATOMS_MODEL", "")

    APP_NAME: str = "Atoms Demo"


settings = Settings()
