"""Add covering indexes for live analytics queries.

Revision ID: 20261030_0008
Revises: 20261030_0007
Create Date: 2026-10-30
"""
from alembic import op


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
    if op.get_bind().dialect.name == "sqlite":
        return

    for name, table, columns in INDEXES:
        op.create_index(name, table, columns)


def downgrade() -> None:
    if op.get_bind().dialect.name == "sqlite":
        return

    for name, table, _ in reversed(INDEXES):
        op.drop_index(name, table_name=table)
