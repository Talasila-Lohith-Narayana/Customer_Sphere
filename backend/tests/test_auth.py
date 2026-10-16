from datetime import datetime, timedelta, timezone
import re
from types import SimpleNamespace
from unittest.mock import MagicMock
from fastapi import HTTPException
import pytest
from jose import jwt
from app.core.config import ADMIN_USERNAME, ADMIN_PASSWORD, VIEWER_USERNAME, VIEWER_PASSWORD, SECRET, ALGO
from app.core.database import SessionLocal
from app.models import AppUser
from app.api.auth.router import delete_user


def test_login_admin_success(client):
    """Verifies that the admin user can authenticate and receives a valid token."""
    response = client.post(
        "/api/auth/login",
        json={"username": ADMIN_USERNAME, "password": ADMIN_PASSWORD},
    )
    assert response.status_code == 200
    data = response.json()
    assert "access_token" in data
    assert data["role"] == "admin"
    assert data["username"] == ADMIN_USERNAME

    # Verify the JWT token can be decoded with our secret
    payload = jwt.decode(data["access_token"], SECRET, algorithms=[ALGO])
    assert payload["sub"] == ADMIN_USERNAME
    assert payload["role"] == "admin"


def test_login_viewer_success(client):
    """Verifies that the analyst/viewer user can authenticate and receives a viewer token."""
    response = client.post(
        "/api/auth/login",
        json={"username": VIEWER_USERNAME, "password": VIEWER_PASSWORD},
    )
    assert response.status_code == 200
    data = response.json()
    assert "access_token" in data
    assert data["role"] == "viewer"
    assert data["username"] == VIEWER_USERNAME


def test_session_validation_endpoint(client, admin_headers):
    response = client.get("/api/auth/session", headers=admin_headers)
    assert response.status_code == 200
    assert response.json() == {"valid": True}


def test_login_wrong_password(client):
    """Verifies that login fails with 401 if the password is incorrect."""
    response = client.post(
        "/api/auth/login",
        json={"username": ADMIN_USERNAME, "password": "wrong_password_123"},
    )
    assert response.status_code == 401
    assert "Invalid username or password" in response.json()["detail"]


def test_login_nonexistent_user(client):
    """Verifies that login fails with 401 for an unregistered username."""
    response = client.post(
        "/api/auth/login",
        json={"username": "ghost_user_9999", "password": "password"},
    )
    assert response.status_code == 401


def test_login_rejects_invalid_request_shape(client):
    invalid_payloads = [
        {"username": "ab", "password": "password"},
        {"username": "admin", "password": "short"},
        {"username": "admin"},
    ]

    for payload in invalid_payloads:
        response = client.post("/api/auth/login", json=payload)
        assert response.status_code == 422


def test_admin_can_create_user_and_new_user_can_log_in(client, admin_headers):
    username = f"user_test_{datetime.now(timezone.utc).timestamp():.0f}"
    password = "new-user-password"
    try:
        response = client.post(
            "/api/auth/users",
            headers=admin_headers,
            json={"username": username, "password": password, "role": "viewer"},
        )
        assert response.status_code == 201
        assert response.json() == {
            "username": username,
            "role": "viewer",
            "access_pages": ["dashboard", "customers", "products", "audit_logs"],
        }

        login_response = client.post(
            "/api/auth/login",
            json={"username": username, "password": password},
        )
        assert login_response.status_code == 200
        assert login_response.json()["role"] == "viewer"

        users_response = client.get("/api/auth/users", headers=admin_headers)
        assert any(user["username"] == username for user in users_response.json())
    finally:
        with SessionLocal() as db:
            db.query(AppUser).filter_by(username=username).delete()
            db.commit()


def test_only_admin_can_manage_users(client, viewer_headers):
    assert client.get("/api/auth/users", headers=viewer_headers).status_code == 403
    assert client.post(
        "/api/auth/users",
        headers=viewer_headers,
        json={
            "username": "viewer_cannot_add",
            "password": "valid-password",
            "role": "admin",
        },
    ).status_code == 403


def test_user_page_access_is_returned_on_login_and_enforced(client, admin_headers):
    username = f"scoped_user_{datetime.now(timezone.utc).timestamp():.0f}"
    password = "scoped-user-password"
    try:
        create_response = client.post(
            "/api/auth/users",
            headers=admin_headers,
            json={
                "username": username,
                "password": password,
                "role": "viewer",
                "access_pages": ["products"],
            },
        )
        assert create_response.status_code == 201
        assert create_response.json()["access_pages"] == ["products"]

        login_response = client.post(
            "/api/auth/login",
            json={"username": username, "password": password},
        )
        assert login_response.status_code == 200
        assert login_response.json()["access_pages"] == ["products"]
        scoped_headers = {
            "Authorization": f"Bearer {login_response.json()['access_token']}"
        }
        assert client.get(
            "/api/dashboard/summary?sections=core",
            headers=scoped_headers,
        ).status_code == 403
        assert client.get("/api/products", headers=scoped_headers).status_code == 200

        update_response = client.patch(
            f"/api/auth/users/{username}",
            headers=admin_headers,
            json={"access_pages": ["analytics"]},
        )
        assert update_response.status_code == 200
        assert update_response.json()["access_pages"] == ["analytics"]
        assert update_response.json()["sessions_revoked"] is True
        assert client.get("/api/auth/profiles", headers=scoped_headers).status_code == 401
        login_response = client.post(
            "/api/auth/login",
            json={"username": username, "password": password},
        )
        scoped_headers = {
            "Authorization": f"Bearer {login_response.json()['access_token']}"
        }
        assert client.get("/api/products", headers=scoped_headers).status_code == 403
        for path in (
            "/api/analytics/clv/summary",
            "/api/analytics/customers/byvaluetier",
            "/api/analytics/delivery/performance",
            "/api/analytics/cohort/summary",
            "/api/analytics/campaigns/active",
            "/api/analytics/campaigns/by-segment",
            "/api/analytics/model/version",
            "/api/analytics/model/calibration",
            "/api/analytics/churn/definition",
        ):
            assert client.get(path, headers=scoped_headers).status_code != 403, path
        assert client.get(
            "/api/analytics/churn/summary",
            headers=scoped_headers,
        ).status_code == 403

        for page, allowed_path, denied_path in (
            ("campaigns", "/api/analytics/campaigns/test-campaign/customers", "/api/analytics/model/version"),
            ("model", "/api/analytics/churn/summary", "/api/analytics/campaigns/active"),
            ("customers", "/api/analytics/customers/test-customer/clv", "/api/analytics/clv/summary"),
            ("audit_logs", "/api/audit-logs", "/api/products"),
            ("dashboard", "/api/dashboard/summary?sections=core", "/api/products"),
        ):
            update_response = client.patch(
                f"/api/auth/users/{username}",
                headers=admin_headers,
                json={"access_pages": [page]},
            )
            assert update_response.status_code == 200
            assert update_response.json()["sessions_revoked"] is True
            assert client.get("/api/auth/profiles", headers=scoped_headers).status_code == 401
            login_response = client.post(
                "/api/auth/login",
                json={"username": username, "password": password},
            )
            scoped_headers = {
                "Authorization": f"Bearer {login_response.json()['access_token']}"
            }
            assert client.get(allowed_path, headers=scoped_headers).status_code != 403
            assert client.get(denied_path, headers=scoped_headers).status_code == 403

        update_response = client.patch(
            f"/api/auth/users/{username}",
            headers=admin_headers,
            json={"access_pages": ["customers"]},
        )
        assert update_response.status_code == 200
        assert update_response.json()["sessions_revoked"] is True
        assert client.get("/api/auth/profiles", headers=scoped_headers).status_code == 401
        login_response = client.post(
            "/api/auth/login",
            json={"username": username, "password": password},
        )
        scoped_headers = {
            "Authorization": f"Bearer {login_response.json()['access_token']}"
        }
        for path in (
            "/api/analytics/customers/test-customer/clv",
            "/api/analytics/customers/test-customer/delivery",
            "/api/analytics/customers/test-customer/explanation",
            "/api/analytics/members/test-customer/risk",
            "/api/customers/test-customer/audit-logs",
        ):
            assert client.get(path, headers=scoped_headers).status_code != 403, path
        assert client.post(
            "/api/analytics/campaigns/evaluate",
            headers=scoped_headers,
            json={"customer_unique_id": "test-customer"},
        ).status_code != 403

        update_response = client.patch(
            f"/api/auth/users/{username}",
            headers=admin_headers,
            json={"access_pages": ["model"]},
        )
        assert update_response.status_code == 200
        assert update_response.json()["sessions_revoked"] is True
        assert client.get("/api/auth/profiles", headers=scoped_headers).status_code == 401
        login_response = client.post(
            "/api/auth/login",
            json={"username": username, "password": password},
        )
        scoped_headers = {
            "Authorization": f"Bearer {login_response.json()['access_token']}"
        }
        for path in (
            "/api/analytics/churn/summary",
            "/api/analytics/churn/top-features",
            "/api/analytics/churn/feature-importance-global",
            "/api/analytics/data/last-refresh",
            "/api/analytics/churn/probability-distribution",
            "/api/analytics/churn/reason-codes/summary",
            "/api/analytics/model/performance-summary",
            "/api/analytics/model/comparison",
            "/api/analytics/model/version",
            "/api/analytics/model/calibration",
            "/api/analytics/model/imbalance-experiments",
            "/api/analytics/churn/definition",
        ):
            assert client.get(path, headers=scoped_headers).status_code != 403, path
    finally:
        with SessionLocal() as db:
            db.query(AppUser).filter_by(username=username).delete()
            db.commit()


def test_viewer_must_have_at_least_one_valid_page(client, admin_headers):
    empty_access = client.post(
        "/api/auth/users",
        headers=admin_headers,
        json={
            "username": "empty_access_user",
            "password": "valid-password",
            "role": "viewer",
            "access_pages": [],
        },
    )
    unknown_page = client.post(
        "/api/auth/users",
        headers=admin_headers,
        json={
            "username": "unknown_page_user",
            "password": "valid-password",
            "role": "viewer",
            "access_pages": ["not-a-page"],
        },
    )
    assert empty_access.status_code == 422
    assert unknown_page.status_code == 422

    empty_update = client.patch(
        f"/api/auth/users/{VIEWER_USERNAME}",
        headers=admin_headers,
        json={"access_pages": []},
    )
    unknown_update = client.patch(
        f"/api/auth/users/{VIEWER_USERNAME}",
        headers=admin_headers,
        json={"access_pages": ["not-a-page"]},
    )
    assert empty_update.status_code == 422
    assert unknown_update.status_code == 422


@pytest.mark.parametrize(
    "path",
    [
        "/api/analytics/churn/summary",
        "/api/analytics/campaigns/active",
        "/api/analytics/cohort/summary",
        "/api/analytics/clv/summary",
        "/api/analytics/model/version",
    ],
)
def test_ungranted_viewer_cannot_view_analytics_and_model_details(
    client,
    admin_headers,
    path,
):
    username = f"no_model_access_{datetime.now(timezone.utc).timestamp():.0f}"
    password = "model-access-test-password"
    try:
        created = client.post(
            "/api/auth/users",
            headers=admin_headers,
            json={
                "username": username,
                "password": password,
                "role": "viewer",
                "access_pages": ["dashboard"],
            },
        )
        assert created.status_code == 201
        login = client.post(
            "/api/auth/login",
            json={"username": username, "password": password},
        )
        assert login.status_code == 200
        headers = {"Authorization": f"Bearer {login.json()['access_token']}"}
        assert client.get(path, headers=headers).status_code == 403
    finally:
        with SessionLocal() as db:
            db.query(AppUser).filter_by(username=username).delete()
            db.commit()


def test_authenticated_users_can_list_profiles_but_anonymous_users_cannot(
    client,
    admin_headers,
    viewer_headers,
):
    admin_response = client.get("/api/auth/profiles", headers=admin_headers)
    viewer_response = client.get("/api/auth/profiles", headers=viewer_headers)
    anonymous_response = client.get("/api/auth/profiles")

    assert admin_response.status_code == 200
    assert viewer_response.status_code == 200
    assert anonymous_response.status_code == 401
    assert all(set(profile) == {"username", "role"} for profile in viewer_response.json())


def test_duplicate_user_creation_returns_conflict(client, admin_headers):
    response = client.post(
        "/api/auth/users",
        headers=admin_headers,
        json={
            "username": ADMIN_USERNAME,
            "password": "valid-password",
            "role": "viewer",
        },
    )
    assert response.status_code == 409


def test_admin_can_update_username_and_password(client, admin_headers):
    original_username = f"edit_user_{datetime.now(timezone.utc).timestamp():.0f}"
    updated_username = f"{original_username}_renamed"
    initial_password = "initial-user-password"
    updated_password = "updated-user-password"
    try:
        create_response = client.post(
            "/api/auth/users",
            headers=admin_headers,
            json={
                "username": original_username,
                "password": initial_password,
                "role": "viewer",
            },
        )
        assert create_response.status_code == 201
        old_login = client.post(
            "/api/auth/login",
            json={"username": original_username, "password": initial_password},
        )
        assert old_login.status_code == 200
        old_headers = {
            "Authorization": f"Bearer {old_login.json()['access_token']}"
        }

        update_response = client.patch(
            f"/api/auth/users/{original_username}",
            headers=admin_headers,
            json={"username": updated_username, "password": updated_password},
        )
        assert update_response.status_code == 200
        assert update_response.json()["username"] == updated_username
        assert update_response.json()["role"] == "viewer"
        assert update_response.json()["sessions_revoked"] is True
        assert "password" not in update_response.json()
        assert client.get("/api/auth/profiles", headers=old_headers).status_code == 401

        assert client.post(
            "/api/auth/login",
            json={"username": original_username, "password": initial_password},
        ).status_code == 401
        login_response = client.post(
            "/api/auth/login",
            json={"username": updated_username, "password": updated_password},
        )
        assert login_response.status_code == 200
        assert login_response.json()["role"] == "viewer"
    finally:
        with SessionLocal() as db:
            db.query(AppUser).filter(
                AppUser.username.in_([original_username, updated_username])
            ).delete(synchronize_session=False)
            db.commit()


def test_user_update_requires_admin_and_valid_values(client, admin_headers, viewer_headers):
    username = f"edit_guard_{datetime.now(timezone.utc).timestamp():.0f}"
    try:
        created = client.post(
            "/api/auth/users",
            headers=admin_headers,
            json={"username": username, "password": "initial-user-password"},
        )
        assert created.status_code == 201

        forbidden = client.patch(
            f"/api/auth/users/{username}",
            headers=viewer_headers,
            json={"password": "changed-password"},
        )
        duplicate = client.patch(
            f"/api/auth/users/{username}",
            headers=admin_headers,
            json={"username": ADMIN_USERNAME},
        )
        short_password = client.patch(
            f"/api/auth/users/{username}",
            headers=admin_headers,
            json={"password": "short"},
        )
        empty_update = client.patch(
            f"/api/auth/users/{username}",
            headers=admin_headers,
            json={},
        )
        missing_user = client.patch(
            "/api/auth/users/no_such_user",
            headers=admin_headers,
            json={"password": "changed-password"},
        )

        assert forbidden.status_code == 403
        assert duplicate.status_code == 409
        assert short_password.status_code == 422
        assert empty_update.status_code == 422
        assert missing_user.status_code == 404
    finally:
        with SessionLocal() as db:
            db.query(AppUser).filter_by(username=username).delete()
            db.commit()


def test_admin_can_delete_user_and_deleted_sessions_are_revoked(client, admin_headers):
    username = f"delete_user_{datetime.now(timezone.utc).timestamp():.0f}"
    password = "delete-user-password"
    try:
        create_response = client.post(
            "/api/auth/users",
            headers=admin_headers,
            json={"username": username, "password": password, "role": "viewer"},
        )
        assert create_response.status_code == 201
        login_response = client.post(
            "/api/auth/login",
            json={"username": username, "password": password},
        )
        assert login_response.status_code == 200
        user_headers = {
            "Authorization": f"Bearer {login_response.json()['access_token']}"
        }

        delete_response = client.delete(
            f"/api/auth/users/{username}",
            headers=admin_headers,
        )
        assert delete_response.status_code == 200
        assert delete_response.json() == {
            "username": username,
            "role": "viewer",
            "access_pages": ["dashboard", "customers", "products", "audit_logs"],
        }
        assert client.post(
            "/api/auth/login",
            json={"username": username, "password": password},
        ).status_code == 401
        assert client.get(
            "/api/auth/profiles",
            headers=user_headers,
        ).status_code == 401
    finally:
        with SessionLocal() as db:
            db.query(AppUser).filter_by(username=username).delete()
            db.commit()


def test_only_admin_can_delete_users_and_active_admin_cannot_delete_self(
    client,
    admin_headers,
    viewer_headers,
):
    username = f"delete_guard_{datetime.now(timezone.utc).timestamp():.0f}"
    try:
        created = client.post(
            "/api/auth/users",
            headers=admin_headers,
            json={"username": username, "password": "valid-delete-password"},
        )
        assert created.status_code == 201

        forbidden = client.delete(
            f"/api/auth/users/{username}",
            headers=viewer_headers,
        )
        self_delete = client.delete(
            f"/api/auth/users/{ADMIN_USERNAME}",
            headers=admin_headers,
        )

        assert forbidden.status_code == 403
        assert self_delete.status_code == 409
    finally:
        with SessionLocal() as db:
            db.query(AppUser).filter_by(username=username).delete()
            db.commit()


def test_delete_user_prevents_deleting_the_last_administrator():
    last_admin = SimpleNamespace(username="last_admin", role="admin")
    existing_user_query = MagicMock()
    existing_user_query.filter_by.return_value.first.return_value = last_admin
    admin_count_query = MagicMock()
    admin_count_query.filter_by.return_value.count.return_value = 1
    db = MagicMock()
    db.query.side_effect = [existing_user_query, admin_count_query]

    with pytest.raises(HTTPException) as error:
        delete_user("last_admin", db, {"sub": "another_admin", "role": "admin"})

    assert error.value.status_code == 409
    db.delete.assert_not_called()
    db.commit.assert_not_called()


def test_user_creation_rejects_short_password_and_unknown_role(client, admin_headers):
    short_password = client.post(
        "/api/auth/users",
        headers=admin_headers,
        json={"username": "short_password_user", "password": "short", "role": "viewer"},
    )
    unknown_role = client.post(
        "/api/auth/users",
        headers=admin_headers,
        json={"username": "unknown_role_user", "password": "valid-password", "role": "owner"},
    )
    short_username = client.post(
        "/api/auth/users",
        headers=admin_headers,
        json={"username": " a ", "password": "valid-password", "role": "viewer"},
    )

    assert short_password.status_code == 422
    assert unknown_role.status_code == 422
    assert short_username.status_code == 422


def test_protected_route_unauthorized(client):
    """Verifies that calling a protected route without authorization returns 401."""
    response = client.get("/api/dashboard/summary")
    assert response.status_code == 401


def test_protected_route_invalid_token(client):
    """Verifies that calling a protected route with a malformed token returns 401."""
    response = client.get(
        "/api/dashboard/summary",
        headers={"Authorization": "Bearer not_a_valid_token"},
    )
    assert response.status_code == 401


def test_protected_route_expired_token(client):
    """Verifies that calling a protected route with an expired token returns 401."""
    expired_payload = {
        "sub": ADMIN_USERNAME,
        "role": "admin",
        "exp": datetime.now(timezone.utc) - timedelta(hours=1),
    }
    expired_token = jwt.encode(expired_payload, SECRET, algorithm=ALGO)

    response = client.get(
        "/api/dashboard/summary",
        headers={"Authorization": f"Bearer {expired_token}"},
    )
    assert response.status_code == 401


def _api_operations():
    from app.main import app

    return [
        (method, path, operation)
        for path, path_item in app.openapi()["paths"].items()
        for method, operation in path_item.items()
        if method in {"get", "post", "put", "patch", "delete", "options", "head"}
    ]


def test_api_operation_inventory_is_complete():
    """The application exposes the documented 61-operation API surface."""
    from app.main import app

    operations = _api_operations()
    assert len(operations) == 61
    removed_paths = {
        "/api/health",
        "/api/analytics/clv/by-segment",
        "/api/analytics/clv/distribution",
        "/api/analytics/customers/cohort-retention",
        "/api/analytics/customers/single-vs-repeat",
        "/api/analytics/model/threshold-analysis",
        "/api/analytics/features/summary",
        "/api/analytics/features/distribution",
        "/api/analytics/features/churn-by-feature",
        "/api/analytics/predict",
        "/api/analytics/data/tables",
    }
    assert removed_paths.isdisjoint(app.openapi()["paths"])


@pytest.mark.parametrize(
    ("method", "path", "operation"),
    _api_operations(),
    ids=lambda value: value if isinstance(value, str) else None,
)
def test_api_operations_require_authentication(client, method, path, operation):
    """Every protected operation rejects requests without a bearer token."""
    login = ("post", "/api/auth/login")
    if (method, path) == login:
        assert not operation.get("security")
        return

    assert operation.get("security")
    request_path = re.sub(r"\{[^}]+\}", "test-value", path)
    response = client.request(method.upper(), request_path)
    assert response.status_code == 401, f"{method.upper()} {path} did not reject anonymous access"
