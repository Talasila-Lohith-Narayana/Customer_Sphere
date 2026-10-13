from datetime import datetime, timedelta, timezone
import pytest
from jose import jwt

from app.core.config import SECRET, ALGO, ADMIN_USERNAME, VIEWER_USERNAME

INTEGRATION_FIXTURES = {
    "client",
    "db_session",
    "admin_token",
    "admin_headers",
    "viewer_token",
    "viewer_headers",
}


def pytest_collection_modifyitems(config, items):
    """Mark tests that need the live MySQL database so CI can skip them."""
    for item in items:
        if INTEGRATION_FIXTURES.intersection(getattr(item, "fixturenames", ())):
            item.add_marker(pytest.mark.integration)


@pytest.fixture(scope="session")
def client():
    """Session-level TestClient instance."""
    from fastapi.testclient import TestClient
    from app.main import app

    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture(scope="session")
def db_session():
    """Provides a database session for tests that inspect or verify database state directly."""
    from app.core.database import SessionLocal

    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


@pytest.fixture(scope="session")
def admin_token():
    """Generates a valid JWT token with admin privileges."""
    payload = {
        "sub": ADMIN_USERNAME,
        "role": "admin",
        "exp": datetime.now(timezone.utc) + timedelta(hours=2),
    }
    return jwt.encode(payload, SECRET, algorithm=ALGO)


@pytest.fixture(scope="session")
def admin_headers(admin_token):
    """Authorization header dictionary for admin requests."""
    return {"Authorization": f"Bearer {admin_token}"}


@pytest.fixture(scope="session")
def viewer_token():
    """Generates a valid JWT token with viewer (analyst) read-only privileges."""
    payload = {
        "sub": VIEWER_USERNAME,
        "role": "viewer",
        "exp": datetime.now(timezone.utc) + timedelta(hours=2),
    }
    return jwt.encode(payload, SECRET, algorithm=ALGO)


@pytest.fixture(scope="session")
def viewer_headers(viewer_token):
    """Authorization header dictionary for viewer requests."""
    return {"Authorization": f"Bearer {viewer_token}"}
