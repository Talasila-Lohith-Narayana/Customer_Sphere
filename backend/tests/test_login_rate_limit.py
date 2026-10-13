from app.api.auth.login_rate_limit import LoginAttemptLimiter
from fastapi.middleware.cors import CORSMiddleware


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


def test_cors_exposes_retry_after_header_to_frontend():
    from app.main import app

    cors_middleware = next(
        middleware
        for middleware in app.user_middleware
        if middleware.cls is CORSMiddleware
    )
    assert cors_middleware.kwargs["expose_headers"] == ["Retry-After"]
