from app.api.auth.login_rate_limit import LoginAttemptLimiter
from fastapi.middleware.cors import CORSMiddleware
from starlette.requests import Request


def test_login_attempt_limiter_allows_five_failures_and_blocks_the_next_attempt():
    limiter = LoginAttemptLimiter()

    for _ in range(5):
        assert limiter.retry_after("192.0.2.1") is None
        limiter.record_failure("192.0.2.1")

    assert limiter.retry_after("192.0.2.1") == 900


def test_login_attempt_limiter_expires_failures_after_fifteen_minutes():
    now = [0.0]
    limiter = LoginAttemptLimiter(clock=lambda: now[0])

    for _ in range(5):
        limiter.record_failure("192.0.2.1")

    now[0] = 899.0
    assert limiter.retry_after("192.0.2.1") == 1

    now[0] = 900.0
    assert limiter.retry_after("192.0.2.1") is None


def test_login_attempt_limiter_tracks_clients_independently_and_can_clear_success():
    limiter = LoginAttemptLimiter()

    for _ in range(5):
        limiter.record_failure("192.0.2.1")

    assert limiter.retry_after("192.0.2.2") is None

    limiter.clear("192.0.2.1")
    assert limiter.retry_after("192.0.2.1") is None


def test_forwarded_client_ip_is_ignored_when_peer_is_not_trusted():
    from app.api.auth.login_rate_limit import get_client_ip

    request = Request(
        {
            "type": "http",
            "client": ("203.0.113.10", 1234),
            "headers": [(b"x-forwarded-for", b"198.51.100.20")],
        }
    )

    assert get_client_ip(request, ("10.0.0.0/8",)) == "203.0.113.10"


def test_forwarded_client_ip_walks_only_the_trusted_proxy_chain():
    from app.api.auth.login_rate_limit import get_client_ip

    request = Request(
        {
            "type": "http",
            "client": ("10.0.0.2", 1234),
            "headers": [(b"x-forwarded-for", b"198.51.100.20, 10.0.0.9")],
        }
    )

    assert get_client_ip(request, ("10.0.0.0/24",)) == "198.51.100.20"


def test_malformed_forwarded_client_ip_falls_back_to_the_peer():
    from app.api.auth.login_rate_limit import get_client_ip

    request = Request(
        {
            "type": "http",
            "client": ("10.0.0.2", 1234),
            "headers": [(b"x-forwarded-for", b"not-an-ip")],
        }
    )

    assert get_client_ip(request, ("10.0.0.0/24",)) == "10.0.0.2"


def test_cors_exposes_retry_after_header_to_frontend():
    from app.main import app

    cors_middleware = next(
        middleware
        for middleware in app.user_middleware
        if middleware.cls is CORSMiddleware
    )
    assert cors_middleware.kwargs["expose_headers"] == ["Retry-After"]
