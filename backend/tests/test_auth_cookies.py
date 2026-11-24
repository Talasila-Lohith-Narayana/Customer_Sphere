import pytest
from fastapi import HTTPException, Request, Response

from app.core.auth_cookies import (
    ACCESS_TOKEN_COOKIE,
    CSRF_TOKEN_COOKIE,
    clear_auth_cookies,
    ensure_csrf_cookie,
    set_auth_cookies,
    validate_csrf_request,
)


def make_request(method, cookies="", csrf_token=""):
    headers = []
    if cookies:
        headers.append((b"cookie", cookies.encode()))
    if csrf_token:
        headers.append((b"x-csrf-token", csrf_token.encode()))
    return Request(
        {
            "type": "http",
            "http_version": "1.1",
            "method": method,
            "scheme": "http",
            "path": "/api/auth/logout",
            "raw_path": b"/api/auth/logout",
            "query_string": b"",
            "headers": headers,
            "server": ("testserver", 80),
            "client": ("testclient", 50000),
        }
    )


def test_auth_cookie_is_httponly_and_csrf_cookie_is_script_readable():
    response = Response()
    csrf_token = "csrf-value"

    set_auth_cookies(response, "signed-token", csrf_token)
    auth_cookie = next(
        value
        for value in response.headers.getlist("set-cookie")
        if value.startswith(f"{ACCESS_TOKEN_COOKIE}=")
    )
    csrf_cookie = next(
        value
        for value in response.headers.getlist("set-cookie")
        if value.startswith(f"{CSRF_TOKEN_COOKIE}=")
    )

    assert "httponly" in auth_cookie.lower()
    assert "httponly" not in csrf_cookie.lower()
    assert csrf_token in csrf_cookie


def test_csrf_validation_requires_matching_cookie_and_header():
    token = ensure_csrf_cookie(make_request("GET"), Response())
    request = make_request(
        "POST",
        cookies=f"{CSRF_TOKEN_COOKIE}={token}",
        csrf_token=token,
    )
    validate_csrf_request(request)

    with pytest.raises(HTTPException) as exc_info:
        validate_csrf_request(
            make_request(
                "POST",
                cookies=f"{CSRF_TOKEN_COOKIE}={token}",
                csrf_token="different",
            )
        )
    assert exc_info.value.status_code == 403

    with pytest.raises(HTTPException) as exc_info:
        validate_csrf_request(
            make_request(
                "POST",
                cookies=f"{CSRF_TOKEN_COOKIE}=forged",
                csrf_token="forged",
            )
        )
    assert exc_info.value.status_code == 403


def test_csrf_bootstrap_and_logout_clear_both_cookies():
    response = Response()
    token = ensure_csrf_cookie(make_request("GET"), response)
    assert token
    assert any(
        value.startswith(f"{CSRF_TOKEN_COOKIE}={token}")
        for value in response.headers.getlist("set-cookie")
    )

    clear_auth_cookies(response)
    cleared_cookies = response.headers.getlist("set-cookie")
    assert any(
        value.startswith(f"{ACCESS_TOKEN_COOKIE}=") and "max-age=0" in value.lower()
        for value in cleared_cookies
    )
    assert any(
        value.startswith(f"{CSRF_TOKEN_COOKIE}=") and "max-age=0" in value.lower()
        for value in cleared_cookies
    )
