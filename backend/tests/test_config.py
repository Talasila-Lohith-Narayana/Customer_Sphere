import pytest

from app.core.config import (
    JWT_SECRET_PLACEHOLDERS,
    MIN_JWT_SECRET_LENGTH,
    env_flag,
    validate_jwt_secret,
)


def test_validate_jwt_secret_accepts_a_long_unique_value():
    secret = "a" * MIN_JWT_SECRET_LENGTH
    assert validate_jwt_secret(secret) == secret


def test_validate_jwt_secret_strips_whitespace():
    secret = "b" * MIN_JWT_SECRET_LENGTH
    assert validate_jwt_secret(f"  {secret}  ") == secret


@pytest.mark.parametrize("value", [None, "", "   "])
def test_validate_jwt_secret_requires_a_value(value):
    with pytest.raises(RuntimeError, match="JWT_SECRET_KEY must be set"):
        validate_jwt_secret(value)


@pytest.mark.parametrize("value", sorted(JWT_SECRET_PLACEHOLDERS))
def test_validate_jwt_secret_rejects_placeholders(value):
    with pytest.raises(RuntimeError, match="placeholder"):
        validate_jwt_secret(value)


def test_validate_jwt_secret_rejects_short_secrets():
    with pytest.raises(RuntimeError, match="at least 32 characters"):
        validate_jwt_secret("short-but-not-a-placeholder")


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        (None, False),
        ("true", True),
        ("TRUE", True),
        ("1", True),
        ("yes", True),
        ("on", True),
        ("false", False),
        ("0", False),
        ("no", False),
    ],
)
def test_env_flag_parses_common_boolean_strings(monkeypatch, value, expected):
    if value is None:
        monkeypatch.delenv("ALLOW_BOOTSTRAP_USERS", raising=False)
    else:
        monkeypatch.setenv("ALLOW_BOOTSTRAP_USERS", value)
    assert env_flag("ALLOW_BOOTSTRAP_USERS") is expected


def test_env_flag_honors_default_when_unset(monkeypatch):
    monkeypatch.delenv("ALLOW_BOOTSTRAP_USERS", raising=False)
    assert env_flag("ALLOW_BOOTSTRAP_USERS") is False
    assert env_flag("ALLOW_BOOTSTRAP_USERS", default=True) is True
