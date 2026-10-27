import os
from uuid import uuid4

import pytest
from jose import jwt
from redis import Redis
from sqlalchemy import text

from app.api.auth.login_rate_limit import RedisLoginAttemptLimiter
from app.core.config import ALGO, SECRET
from app.models import AppUser


@pytest.fixture
def ci_admin_headers(db_session):
    username = f"ci-api-admin-{uuid4().hex}"
    db_session.add(
        AppUser(
            username=username,
            password_hash="integration-test-only",
            role="admin",
        )
    )
    db_session.flush()
    token = jwt.encode(
        {
            "sub": username,
            "role": "admin",
            "token_version": 0,
        },
        SECRET,
        algorithm=ALGO,
    )
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def mysql_customer_table(db_session):
    try:
        db_session.execute(text("""
            CREATE TEMPORARY TABLE customers (
                customer_unique_id VARCHAR(32) NOT NULL PRIMARY KEY
            )
        """))
        db_session.execute(
            text("INSERT INTO customers (customer_unique_id) VALUES (:customer_id)"),
            {"customer_id": "ci-api-existing-customer"},
        )
        yield
    finally:
        db_session.execute(text("DROP TEMPORARY TABLE IF EXISTS customers"))


@pytest.fixture
def mysql_product_tables(db_session):
    try:
        db_session.execute(text("""
            CREATE TEMPORARY TABLE products (
                product_id VARCHAR(64) NOT NULL PRIMARY KEY,
                product_category_name VARCHAR(64),
                product_weight_g INT,
                product_photos_qty INT
            )
        """))
        db_session.execute(text("""
            CREATE TEMPORARY TABLE order_items (
                order_item_id INT NOT NULL PRIMARY KEY,
                product_id VARCHAR(64) NOT NULL,
                order_id VARCHAR(64) NOT NULL,
                price DECIMAL(10, 2),
                freight_value DECIMAL(10, 2)
            )
        """))
        db_session.execute(text("""
            CREATE TEMPORARY TABLE order_reviews (
                review_id VARCHAR(64) NOT NULL PRIMARY KEY,
                order_id VARCHAR(64) NOT NULL,
                review_score INT
            )
        """))
        db_session.execute(text("""
            INSERT INTO products VALUES ('ci-product', 'ci_category', 500, 2)
        """))
        db_session.execute(text("""
            INSERT INTO order_items VALUES (1, 'ci-product', 'ci-order', 25.50, 4.25)
        """))
        db_session.execute(text("""
            INSERT INTO order_reviews VALUES ('ci-review', 'ci-order', 5)
        """))
        yield
    finally:
        db_session.execute(text("DROP TEMPORARY TABLE IF EXISTS order_reviews"))
        db_session.execute(text("DROP TEMPORARY TABLE IF EXISTS order_items"))
        db_session.execute(text("DROP TEMPORARY TABLE IF EXISTS products"))


@pytest.mark.integration
def test_mysql_ci_database_can_create_read_and_delete_an_account(db_session):
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
def test_customer_id_availability_api_uses_mysql(client, ci_admin_headers, mysql_customer_table):
    existing = client.get(
        "/api/customers/id-availability",
        params={"customer_unique_id": "ci-api-existing-customer"},
        headers=ci_admin_headers,
    )
    available = client.get(
        "/api/customers/id-availability",
        params={"customer_unique_id": "ci-api-new-customer"},
        headers=ci_admin_headers,
    )

    assert existing.status_code == 200
    assert existing.json() == {"available": False}
    assert available.status_code == 200
    assert available.json() == {"available": True}


@pytest.mark.integration
def test_product_catalog_api_returns_mysql_aggregates(client, ci_admin_headers, mysql_product_tables):
    response = client.get("/api/products?page=1&limit=5", headers=ci_admin_headers)

    assert response.status_code == 200
    assert response.json()["total"] == 1
    assert response.json()["items"] == [{
        "product_id": "ci-product",
        "category_name": "ci_category",
        "weight_g": 500,
        "photos_qty": 2,
        "total_units_sold": 1,
        "total_revenue": 25.5,
        "avg_price": 25.5,
        "avg_freight": 4.25,
        "avg_rating": 5.0,
        "total_reviews": 1,
    }]


@pytest.mark.integration
def test_model_version_api_returns_metadata_shape(client, ci_admin_headers):
    response = client.get("/api/analytics/model/version", headers=ci_admin_headers)

    assert response.status_code == 200
    assert response.json()["model_name"] == "LightGBM Classifier"
    assert isinstance(response.json()["features"], list)
    assert response.json()["features_count"] == len(response.json()["features"])


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
