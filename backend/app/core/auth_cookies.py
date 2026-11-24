import hmac
import hashlib
import os
import secrets

from fastapi import HTTPException, Request, Response
from .config import SECRET

ACCESS_TOKEN_COOKIE = "ci_access_token"
CSRF_TOKEN_COOKIE = "ci_csrf_token"
ACCESS_TOKEN_MAX_AGE = 8 * 60 * 60
_secure_value = os.getenv("AUTH_COOKIE_SECURE", "true").strip().lower()
if _secure_value not in {"1", "true", "yes", "0", "false", "no"}:
    raise RuntimeError("AUTH_COOKIE_SECURE must be a boolean value.")
AUTH_COOKIE_SECURE = _secure_value in {"1", "true", "yes"}
AUTH_COOKIE_SAMESITE = os.getenv("AUTH_COOKIE_SAMESITE", "lax").strip().lower()

if AUTH_COOKIE_SAMESITE not in {"lax", "strict", "none"}:
    raise RuntimeError("AUTH_COOKIE_SAMESITE must be lax, strict, or none.")
if AUTH_COOKIE_SAMESITE == "none" and not AUTH_COOKIE_SECURE:
    raise RuntimeError("SameSite=None authentication cookies require Secure.")


def _new_csrf_token() -> str:
    nonce = secrets.token_urlsafe(32)
    signature = hmac.new(
        SECRET.encode("utf-8"),
        nonce.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    return f"{nonce}.{signature}"


def _is_valid_csrf_token(token: str) -> bool:
    try:
        nonce, signature = token.rsplit(".", 1)
    except ValueError:
        return False
    expected_signature = hmac.new(
        SECRET.encode("utf-8"),
        nonce.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    return hmac.compare_digest(signature, expected_signature)


def ensure_csrf_cookie(request: Request, response: Response) -> str:
    existing_token = request.cookies.get(CSRF_TOKEN_COOKIE, "")
    token = existing_token if _is_valid_csrf_token(existing_token) else _new_csrf_token()
    response.set_cookie(
        CSRF_TOKEN_COOKIE,
        token,
        max_age=ACCESS_TOKEN_MAX_AGE,
        path="/",
        secure=AUTH_COOKIE_SECURE,
        httponly=False,
        samesite=AUTH_COOKIE_SAMESITE,
    )
    return token


def set_auth_cookies(response: Response, token: str, csrf_token: str) -> None:
    response.set_cookie(
        ACCESS_TOKEN_COOKIE,
        token,
        max_age=ACCESS_TOKEN_MAX_AGE,
        path="/",
        secure=AUTH_COOKIE_SECURE,
        httponly=True,
        samesite=AUTH_COOKIE_SAMESITE,
    )
    response.set_cookie(
        CSRF_TOKEN_COOKIE,
        csrf_token,
        max_age=ACCESS_TOKEN_MAX_AGE,
        path="/",
        secure=AUTH_COOKIE_SECURE,
        httponly=False,
        samesite=AUTH_COOKIE_SAMESITE,
    )


def clear_auth_cookies(response: Response) -> None:
    response.delete_cookie(
        ACCESS_TOKEN_COOKIE,
        path="/",
        secure=AUTH_COOKIE_SECURE,
        httponly=True,
        samesite=AUTH_COOKIE_SAMESITE,
    )
    response.delete_cookie(
        CSRF_TOKEN_COOKIE,
        path="/",
        secure=AUTH_COOKIE_SECURE,
        httponly=False,
        samesite=AUTH_COOKIE_SAMESITE,
    )


def validate_csrf_request(request: Request) -> None:
    if request.method.upper() in {"GET", "HEAD", "OPTIONS"}:
        return
    cookie_token = request.cookies.get(CSRF_TOKEN_COOKIE, "")
    header_token = request.headers.get("X-CSRF-Token", "")
    if (
        not cookie_token
        or not header_token
        or not hmac.compare_digest(cookie_token, header_token)
        or not _is_valid_csrf_token(cookie_token)
    ):
        raise HTTPException(status_code=403, detail="CSRF validation failed.")
