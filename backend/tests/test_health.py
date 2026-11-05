from fastapi import FastAPI
from fastapi.testclient import TestClient
from redis.exceptions import ConnectionError as RedisConnectionError
from sqlalchemy.exc import OperationalError

from app.api import health


def create_client():
    app = FastAPI()
    app.include_router(health.router)
    return TestClient(app)


def test_liveness_does_not_depend_on_external_services():
    response = create_client().get("/health/live")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_readiness_reports_database_failure(monkeypatch):
    monkeypatch.setattr(health, "RATE_LIMIT_REDIS_URL", None)
    monkeypatch.setattr(
        health.engine,
        "connect",
        lambda: (_ for _ in ()).throw(OperationalError("SELECT 1", {}, Exception("offline"))),
    )

    response = create_client().get("/health/ready")

    assert response.status_code == 503
    assert response.json() == {
        "status": "not_ready",
        "checks": {"database": "unavailable"},
    }


def test_readiness_reports_configured_redis_failure(monkeypatch):
    class DatabaseConnection:
        def __enter__(self):
            return self

        def __exit__(self, *_):
            return False

        @staticmethod
        def execute(_statement):
            return None

    class UnavailableLimiter:
        @staticmethod
        def check_connection():
            raise RedisConnectionError("offline")

    monkeypatch.setattr(health, "RATE_LIMIT_REDIS_URL", "redis://configured")
    monkeypatch.setattr(health.engine, "connect", DatabaseConnection)
    monkeypatch.setattr(health, "login_attempt_limiter", UnavailableLimiter())

    response = create_client().get("/health/ready")

    assert response.status_code == 503
    assert response.json() == {
        "status": "not_ready",
        "checks": {"database": "ok", "redis": "unavailable"},
    }
