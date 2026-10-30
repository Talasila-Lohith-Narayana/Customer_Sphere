"""Cover common state and city geography aggregations.

Revision ID: 20261030_0007
Revises: 20261030_0006
Create Date: 2026-10-30
"""
from alembic import op


revision = "20261030_0007"
down_revision = "20261030_0006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if op.get_bind().dialect.name == "sqlite":
        return

    op.drop_index(
        "ix_geo_order_metrics_state",
        table_name="geo_order_metrics_cache",
    )
    op.drop_index(
        "ix_geo_order_metrics_city",
        table_name="geo_order_metrics_cache",
    )
    op.create_index(
        "ix_geo_order_metrics_state",
        "geo_order_metrics_cache",
        [
            "customer_state",
            "customer_unique_id",
            "order_id",
            "payment_count",
            "total_revenue",
            "order_purchase_timestamp",
        ],
    )
    op.create_index(
        "ix_geo_order_metrics_city",
        "geo_order_metrics_cache",
        [
            "customer_city",
            "customer_state",
            "customer_unique_id",
            "order_id",
            "payment_count",
            "total_revenue",
            "order_purchase_timestamp",
        ],
    )


def downgrade() -> None:
    if op.get_bind().dialect.name == "sqlite":
        return

    op.drop_index(
        "ix_geo_order_metrics_city",
        table_name="geo_order_metrics_cache",
    )
    op.drop_index(
        "ix_geo_order_metrics_state",
        table_name="geo_order_metrics_cache",
    )
    op.create_index(
        "ix_geo_order_metrics_city",
        "geo_order_metrics_cache",
        ["customer_city", "customer_state", "customer_unique_id", "order_id"],
    )
    op.create_index(
        "ix_geo_order_metrics_state",
        "geo_order_metrics_cache",
        ["customer_state", "customer_unique_id", "order_id"],
    )
