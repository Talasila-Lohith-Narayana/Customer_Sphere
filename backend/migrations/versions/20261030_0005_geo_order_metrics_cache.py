"""Maintain order-level geography and revenue aggregates.

Revision ID: 20261030_0005
Revises: 20261030_0004
Create Date: 2026-10-30
"""
from alembic import op


revision = "20261030_0005"
down_revision = "20261030_0004"
branch_labels = None
depends_on = None


def _refresh_order_statement(order_id: str) -> str:
    return f"""
        INSERT INTO geo_order_metrics_cache (
            order_id, customer_id, customer_unique_id, customer_state,
            customer_city, order_purchase_timestamp, total_revenue
        )
        SELECT
            o.order_id, o.customer_id, c.customer_unique_id, c.customer_state,
            c.customer_city, o.order_purchase_timestamp,
            COALESCE(payments.total_revenue, 0)
        FROM orders o
        JOIN customers c ON c.customer_id = o.customer_id
        LEFT JOIN (
            SELECT order_id, SUM(payment_value) AS total_revenue
            FROM order_payments
            WHERE order_id = {order_id}
            GROUP BY order_id
        ) payments ON payments.order_id = o.order_id
        WHERE o.order_id = {order_id}
        ON DUPLICATE KEY UPDATE
            customer_id = VALUES(customer_id),
            customer_unique_id = VALUES(customer_unique_id),
            customer_state = VALUES(customer_state),
            customer_city = VALUES(customer_city),
            order_purchase_timestamp = VALUES(order_purchase_timestamp),
            total_revenue = VALUES(total_revenue)
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
        CREATE TABLE geo_order_metrics_cache (
            order_id CHAR(32) NOT NULL PRIMARY KEY,
            customer_id CHAR(32) NOT NULL,
            customer_unique_id CHAR(32) NOT NULL,
            customer_state CHAR(2) NULL,
            customer_city VARCHAR(64) NULL,
            order_purchase_timestamp DATETIME NULL,
            total_revenue DECIMAL(20, 2) NOT NULL DEFAULT 0,
            INDEX ix_geo_order_metrics_state (
                customer_state, customer_unique_id, order_id
            ),
            INDEX ix_geo_order_metrics_city (
                customer_city, customer_state, customer_unique_id, order_id
            )
        )
        """
    )
    op.execute(
        """
        INSERT INTO geo_order_metrics_cache (
            order_id, customer_id, customer_unique_id, customer_state,
            customer_city, order_purchase_timestamp, total_revenue
        )
        SELECT
            o.order_id, o.customer_id, c.customer_unique_id, c.customer_state,
            c.customer_city, o.order_purchase_timestamp,
            COALESCE(payments.total_revenue, 0)
        FROM orders o
        JOIN customers c ON c.customer_id = o.customer_id
        LEFT JOIN (
            SELECT order_id, SUM(payment_value) AS total_revenue
            FROM order_payments
            GROUP BY order_id
        ) payments ON payments.order_id = o.order_id
        """
    )

    _create_trigger(
        "trg_geo_metrics_orders_ai",
        "INSERT",
        "orders",
        _refresh_order_statement("NEW.order_id"),
    )
    _create_trigger(
        "trg_geo_metrics_orders_au",
        "UPDATE",
        "orders",
        "BEGIN "
        + _refresh_order_statement("OLD.order_id")
        + "; "
        + _refresh_order_statement("NEW.order_id")
        + "; END",
    )
    _create_trigger(
        "trg_geo_metrics_orders_ad",
        "DELETE",
        "orders",
        "DELETE FROM geo_order_metrics_cache WHERE order_id = OLD.order_id",
    )
    _create_trigger(
        "trg_geo_metrics_payments_ai",
        "INSERT",
        "order_payments",
        _refresh_order_statement("NEW.order_id"),
    )
    _create_trigger(
        "trg_geo_metrics_payments_au",
        "UPDATE",
        "order_payments",
        "BEGIN "
        + _refresh_order_statement("OLD.order_id")
        + "; "
        + _refresh_order_statement("NEW.order_id")
        + "; END",
    )
    _create_trigger(
        "trg_geo_metrics_payments_ad",
        "DELETE",
        "order_payments",
        _refresh_order_statement("OLD.order_id"),
    )
    _create_trigger(
        "trg_geo_metrics_customers_au",
        "UPDATE",
        "customers",
        """
        UPDATE geo_order_metrics_cache
        SET customer_id = NEW.customer_id,
            customer_unique_id = NEW.customer_unique_id,
            customer_state = NEW.customer_state,
            customer_city = NEW.customer_city
        WHERE customer_id = OLD.customer_id
        """,
    )


def downgrade() -> None:
    if op.get_bind().dialect.name == "sqlite":
        return

    for trigger in (
        "trg_geo_metrics_customers_au",
        "trg_geo_metrics_payments_ad",
        "trg_geo_metrics_payments_au",
        "trg_geo_metrics_payments_ai",
        "trg_geo_metrics_orders_ad",
        "trg_geo_metrics_orders_au",
        "trg_geo_metrics_orders_ai",
    ):
        op.execute(f"DROP TRIGGER IF EXISTS {trigger}")
    op.execute("DROP TABLE geo_order_metrics_cache")
