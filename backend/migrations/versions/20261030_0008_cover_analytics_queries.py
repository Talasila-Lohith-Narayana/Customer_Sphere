"""Add covering indexes for live analytics queries.

Revision ID: 20261030_0008
Revises: 20261030_0007
Create Date: 2026-10-30
"""
from alembic import op
import sqlalchemy as sa


revision = "20261030_0008"
down_revision = "20261030_0007"
branch_labels = None
depends_on = None


INDEXES = (
    (
        "ix_orders_delivery_analytics",
        "orders",
        [
            "order_status",
            "order_delivered_customer_date",
            "customer_id",
            "order_purchase_timestamp",
            "order_estimated_delivery_date",
        ],
    ),
    (
        "ix_orders_purchase_customer",
        "orders",
        ["order_purchase_timestamp", "customer_id", "order_id"],
    ),
    (
        "ix_order_payments_order_value",
        "order_payments",
        ["order_id", "payment_value"],
    ),
    (
        "ix_order_items_order_product",
        "order_items",
        ["order_id", "product_id"],
    ),
    (
        "ix_order_reviews_order_score",
        "order_reviews",
        ["order_id", "review_score"],
    ),
)


def upgrade() -> None:
    connection = op.get_bind()
    if connection.dialect.name == "sqlite":
        return
    inspector = sa.inspect(connection)
    tables = set(inspector.get_table_names())
    table_columns = {
        table: {column["name"] for column in inspector.get_columns(table)}
        for _, table, _ in INDEXES
        if table in tables
    }

    for name, table, columns in INDEXES:
        if table not in table_columns or not set(columns).issubset(table_columns[table]):
            continue
        op.create_index(name, table, columns)


def downgrade() -> None:
    connection = op.get_bind()
    if connection.dialect.name == "sqlite":
        return
    inspector = sa.inspect(connection)
    tables = set(inspector.get_table_names())

    for name, table, _ in reversed(INDEXES):
        if table not in tables:
            continue
        indexes = {index["name"] for index in inspector.get_indexes(table)}
        if name in indexes:
            op.drop_index(name, table_name=table)
