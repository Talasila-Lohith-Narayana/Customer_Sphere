import os
from dotenv import load_dotenv
from pwdlib import PasswordHash

# Load settings from .env file if available
load_dotenv()

ALGO = "HS256"
MIN_JWT_SECRET_LENGTH = 32
JWT_SECRET_PLACEHOLDERS = frozenset(
    {
        "change-me",
        "changeme",
        "secret",
        "replace-with-a-long-random-secret",
    }
)


def env_flag(name: str, default: bool = False) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def validate_jwt_secret(value: str | None) -> str:
    secret = (value or "").strip()
    if not secret:
        raise RuntimeError(
            "JWT_SECRET_KEY must be set in the environment or .env file."
        )
    if secret.lower() in JWT_SECRET_PLACEHOLDERS:
        raise RuntimeError(
            "JWT_SECRET_KEY is using a placeholder value. "
            "Set a unique secret at least "
            f"{MIN_JWT_SECRET_LENGTH} characters long."
        )
    if len(secret) < MIN_JWT_SECRET_LENGTH:
        raise RuntimeError(
            "JWT_SECRET_KEY must be at least "
            f"{MIN_JWT_SECRET_LENGTH} characters long."
        )
    return secret


# JWT Encryption Configuration for user logins
SECRET = validate_jwt_secret(os.getenv("JWT_SECRET_KEY"))

# Default Admin User Credentials
ADMIN_USERNAME = os.getenv("ADMIN_USERNAME", "admin")
ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD")

# Default Analyst / Viewer User Credentials (Read-only access)
VIEWER_USERNAME = os.getenv("VIEWER_USERNAME", "analyst")
VIEWER_PASSWORD = os.getenv("VIEWER_PASSWORD")

# Create missing default accounts on startup. Existing roles are never overwritten.
ALLOW_BOOTSTRAP_USERS = env_flag("ALLOW_BOOTSTRAP_USERS", default=True)

if not ADMIN_PASSWORD:
    raise RuntimeError("ADMIN_PASSWORD must be set in the environment or .env file.")
if not VIEWER_PASSWORD:
    raise RuntimeError("VIEWER_PASSWORD must be set in the environment or .env file.")

# Password hasher helper
pwd = PasswordHash.recommended()
