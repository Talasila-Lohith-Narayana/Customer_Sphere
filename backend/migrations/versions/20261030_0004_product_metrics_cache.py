"""Maintain live product aggregates for fast catalog queries.

Revision ID: 20261030_0004
Revises: 20261030_0003
Create Date: 2026-10-30
"""
from alembic import op


revision = "20261030_0004"
down_revision = "20261030_0003"
branch_labels = None
depends_on = None


def _product_refresh_statement(product_id: str) -> str:
    return f"""
        INSERT INTO product_metrics_cache (
            product_id, total_units_sold, total_revenue, avg_price, avg_freight,
            avg_rating, total_reviews
        )
        SELECT
            {product_id},
            COUNT(oi.order_item_id),
            COALESCE(SUM(oi.price), 0),
            COALESCE(AVG(oi.price), 0),
            COALESCE(AVG(oi.freight_value), 0),
            (
                SELECT AVG(r.review_score)
                FROM order_items review_items
                JOIN order_reviews r ON r.order_id = review_items.order_id
                WHERE review_items.product_id = {product_id}
            ),
            (
                SELECT COUNT(r.review_id)
                FROM order_items review_items
                JOIN order_reviews r ON r.order_id = review_items.order_id
                WHERE review_items.product_id = {product_id}
            )
        FROM order_items oi
        WHERE oi.product_id = {product_id}
        ON DUPLICATE KEY UPDATE
            total_units_sold = VALUES(total_units_sold),
            total_revenue = VALUES(total_revenue),
            avg_price = VALUES(avg_price),
            avg_freight = VALUES(avg_freight),
            avg_rating = VALUES(avg_rating),
            total_reviews = VALUES(total_reviews)
    """


def _order_refresh_statement(order_id: str) -> str:
    order_products = f"SELECT product_id FROM order_items WHERE order_id = {order_id}"
    return f"""
        INSERT INTO product_metrics_cache (
            product_id, total_units_sold, total_revenue, avg_price, avg_freight,
            avg_rating, total_reviews
        )
        SELECT
            sales.product_id, sales.total_units_sold, sales.total_revenue,
            sales.avg_price, sales.avg_freight, ratings.avg_rating,
            COALESCE(ratings.total_reviews, 0)
        FROM (
            SELECT
                oi.product_id,
                COUNT(oi.order_item_id) AS total_units_sold,
                COALESCE(SUM(oi.price), 0) AS total_revenue,
                COALESCE(AVG(oi.price), 0) AS avg_price,
                COALESCE(AVG(oi.freight_value), 0) AS avg_freight
            FROM order_items oi
            WHERE oi.product_id IN ({order_products})
            GROUP BY oi.product_id
        ) sales
        LEFT JOIN (
            SELECT
                oi.product_id,
                AVG(r.review_score) AS avg_rating,
                COUNT(r.review_id) AS total_reviews
            FROM order_items oi
            JOIN order_reviews r ON r.order_id = oi.order_id
            WHERE oi.product_id IN ({order_products})
            GROUP BY oi.product_id
        ) ratings ON ratings.product_id = sales.product_id
        ON DUPLICATE KEY UPDATE
            total_units_sold = VALUES(total_units_sold),
            total_revenue = VALUES(total_revenue),
            avg_price = VALUES(avg_price),
            avg_freight = VALUES(avg_freight),
            avg_rating = VALUES(avg_rating),
            total_reviews = VALUES(total_reviews)
    """


def _create_trigger(name: str, timing: str, table: str, body: str) -> None:
    op.execute(
        f"CREATE TRIGGER {name} AFTER {timing} ON {table} "
        f"FOR EACH ROW {body}"
    )


def upgrade() -> None:
    if op.get_bind().dialect.name == "sqlite":
        return

    op.execute(
        """
        CREATE TABLE product_metrics_cache (
            product_id CHAR(32) NOT NULL PRIMARY KEY,
            total_units_sold BIGINT UNSIGNED NOT NULL DEFAULT 0,
            total_revenue DECIMAL(20, 2) NOT NULL DEFAULT 0,
            avg_price DECIMAL(12, 4) NOT NULL DEFAULT 0,
            avg_freight DECIMAL(12, 4) NOT NULL DEFAULT 0,
            avg_rating DECIMAL(5, 2) NULL,
            total_reviews BIGINT UNSIGNED NOT NULL DEFAULT 0
        )
        """
    )
    op.execute(
        """
        INSERT INTO product_metrics_cache (
            product_id, total_units_sold, total_revenue, avg_price, avg_freight,
            avg_rating, total_reviews
        )
        SELECT
            p.product_id,
            COALESCE(sales.total_units_sold, 0),
            COALESCE(sales.total_revenue, 0),
            COALESCE(sales.avg_price, 0),
            COALESCE(sales.avg_freight, 0),
            ratings.avg_rating,
            COALESCE(ratings.total_reviews, 0)
        FROM products p
        LEFT JOIN (
            SELECT
                product_id,
                COUNT(order_item_id) AS total_units_sold,
                SUM(price) AS total_revenue,
                AVG(price) AS avg_price,
                AVG(freight_value) AS avg_freight
            FROM order_items
            GROUP BY product_id
        ) sales ON sales.product_id = p.product_id
        LEFT JOIN (
            SELECT
                oi.product_id,
                AVG(r.review_score) AS avg_rating,
                COUNT(r.review_id) AS total_reviews
            FROM order_items oi
            JOIN order_reviews r ON r.order_id = oi.order_id
            GROUP BY oi.product_id
        ) ratings ON ratings.product_id = p.product_id
        """
    )

    _create_trigger(
        "trg_product_metrics_items_ai",
        "INSERT",
        "order_items",
        _product_refresh_statement("NEW.product_id"),
    )
    _create_trigger(
        "trg_product_metrics_items_ad",
        "DELETE",
        "order_items",
        _product_refresh_statement("OLD.product_id"),
    )
    _create_trigger(
        "trg_product_metrics_items_au",
        "UPDATE",
        "order_items",
        "BEGIN "
        + _product_refresh_statement("OLD.product_id")
        + "; "
        + _product_refresh_statement("NEW.product_id")
        + "; END",
    )
    _create_trigger(
        "trg_product_metrics_reviews_ai",
        "INSERT",
        "order_reviews",
        _order_refresh_statement("NEW.order_id"),
    )
    _create_trigger(
        "trg_product_metrics_reviews_ad",
        "DELETE",
        "order_reviews",
        _order_refresh_statement("OLD.order_id"),
    )
    _create_trigger(
        "trg_product_metrics_reviews_au",
        "UPDATE",
        "order_reviews",
        "BEGIN "
        + _order_refresh_statement("OLD.order_id")
        + "; "
        + _order_refresh_statement("NEW.order_id")
        + "; END",
    )


def downgrade() -> None:
    if op.get_bind().dialect.name == "sqlite":
        return

    for trigger in (
        "trg_product_metrics_reviews_au",
        "trg_product_metrics_reviews_ad",
        "trg_product_metrics_reviews_ai",
        "trg_product_metrics_items_au",
        "trg_product_metrics_items_ad",
        "trg_product_metrics_items_ai",
    ):
        op.execute(f"DROP TRIGGER IF EXISTS {trigger}")
    op.execute("DROP TABLE product_metrics_cache")
