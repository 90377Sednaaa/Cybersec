"""Application settings loaded from environment / .env file."""

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # Security
    secret_key: str = "dev-only-change-me-0123456789abcdef0123456789abcdef"
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 60 * 12

    # Bootstrap admin (created on first startup only; change in production)
    admin_email: str = "admin@example.com"
    admin_password: str = "admin123"
    admin_name: str = "Admin"

    # Database
    database_url: str = "sqlite:///./platform.db"

    # CORS (Vite dev server)
    cors_origins: list[str] = ["http://localhost:5173", "http://127.0.0.1:5173"]

    # Optional integration endpoints (used by the scan engine in later milestones)
    zap_api_url: str = "http://127.0.0.1:8080"
    zap_api_key: str = ""


settings = Settings()
