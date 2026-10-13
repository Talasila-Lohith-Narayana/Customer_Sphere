import os
from uuid import uuid4

import pytest
from redis import Redis

from app.api.auth.login_rate_limit import RedisLoginAttemptLimiter
from app.models import AppUser


@pytest.mark.integration
def test_mysql_ci_database_can_create_read_and_delete_an_account(db_session):
    AppUser.__table__.create(bind=db_session.get_bind(), checkfirst=True)
    username = f"ci-smoke-{uuid4().hex}"
    user = AppUser(username=username, password_hash="test-only-hash", role="viewer")

    try:
        db_session.add(user)
        db_session.commit()

        stored_user = (
            db_session.query(AppUser)
            .filter(AppUser.username == username)
            .one()
        )
        assert stored_user.role == "viewer"
    finally:
        db_session.rollback()
        db_session.query(AppUser).filter(AppUser.username == username).delete()
        db_session.commit()


@pytest.mark.integration
def test_redis_ci_service_shares_login_attempt_state():
    redis_url = os.getenv("RATE_LIMIT_REDIS_URL")
    if not redis_url:
        pytest.skip("RATE_LIMIT_REDIS_URL is not configured")

    client = Redis.from_url(redis_url)
    limiter = RedisLoginAttemptLimiter(client, max_attempts=2)
    key = f"ci-smoke-{uuid4().hex}"
    try:
        limiter.record_failure(key)
        limiter.record_failure(key)

        assert limiter.retry_after(key) is not None
    finally:
        limiter.clear(key)
        client.close()
