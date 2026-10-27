from datetime import datetime, timedelta, timezone
import pytest
from jose import jwt
from sqlalchemy.orm import Session

from app.core.config import SECRET, ALGO, ADMIN_USERNAME, VIEWER_USERNAME
from app.core.database import engine, get_db
from app.models import AppUser

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


@pytest.fixture
def client(db_session):
    """Create a request client that uses the test's rollback-scoped database session."""
    from fastapi.testclient import TestClient
    from app.main import app

    def override_get_db():
        yield db_session

    previous_override = app.dependency_overrides.get(get_db)
    app.dependency_overrides[get_db] = override_get_db
    try:
        with TestClient(app) as test_client:
            yield test_client
    finally:
        if previous_override is None:
            app.dependency_overrides.pop(get_db, None)
        else:
            app.dependency_overrides[get_db] = previous_override


@pytest.fixture
def db_session():
    """Roll back database work after each test, including commits made by API routes."""
    connection = engine.connect()
    transaction = connection.begin()
    db = Session(bind=connection, join_transaction_mode="create_savepoint")
    try:
        yield db
    finally:
        db.close()
        if transaction.is_active:
            transaction.rollback()
        connection.close()


@pytest.fixture
def admin_token(db_session):
    """Generates a valid JWT token with admin privileges."""
    account = (
        db_session.query(AppUser)
        .filter_by(username=ADMIN_USERNAME, role="admin")
        .first()
    )
    if account is None:
        raise RuntimeError(f"Configured admin test account {ADMIN_USERNAME!r} is missing.")

    payload = {
        "sub": ADMIN_USERNAME,
        "role": "admin",
        "token_version": account.token_version,
        "exp": datetime.now(timezone.utc) + timedelta(hours=2),
    }
    return jwt.encode(payload, SECRET, algorithm=ALGO)


@pytest.fixture
def admin_headers(admin_token):
    """Authorization header dictionary for admin requests."""
    return {"Authorization": f"Bearer {admin_token}"}


@pytest.fixture
def viewer_token(db_session):
    """Generates a valid JWT token with viewer (analyst) read-only privileges."""
    account = (
        db_session.query(AppUser)
        .filter_by(username=VIEWER_USERNAME, role="viewer")
        .first()
    )
    if account is None:
        raise RuntimeError(f"Configured viewer test account {VIEWER_USERNAME!r} is missing.")

    payload = {
        "sub": VIEWER_USERNAME,
        "role": "viewer",
        "token_version": account.token_version,
        "exp": datetime.now(timezone.utc) + timedelta(hours=2),
    }
    return jwt.encode(payload, SECRET, algorithm=ALGO)


@pytest.fixture
def viewer_headers(viewer_token):
    """Authorization header dictionary for viewer requests."""
    return {"Authorization": f"Bearer {viewer_token}"}
