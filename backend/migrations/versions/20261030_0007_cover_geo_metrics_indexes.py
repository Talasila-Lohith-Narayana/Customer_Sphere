"""Cover common state and city geography aggregations.

Revision ID: 20261030_0007
Revises: 20261030_0006
Create Date: 2026-10-30
"""
from alembic import op
import sqlalchemy as sa


revision = "20261030_0007"
down_revision = "20261030_0006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    connection = op.get_bind()
    if connection.dialect.name == "sqlite":
        return
    inspector = sa.inspect(connection)
    if "geo_order_metrics_cache" not in inspector.get_table_names():
        return
    columns = {
        column["name"]
        for column in inspector.get_columns("geo_order_metrics_cache")
    }
    if not {
        "customer_state",
        "customer_city",
        "customer_unique_id",
        "order_id",
        "payment_count",
        "total_revenue",
        "order_purchase_timestamp",
    }.issubset(columns):
        return
    indexes = {
        index["name"] for index in inspector.get_indexes("geo_order_metrics_cache")
    }
    if not {
        "ix_geo_order_metrics_state",
        "ix_geo_order_metrics_city",
    }.issubset(indexes):
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
    connection = op.get_bind()
    if connection.dialect.name == "sqlite":
        return
    inspector = sa.inspect(connection)
    if "geo_order_metrics_cache" not in inspector.get_table_names():
        return

    indexes = {
        index["name"] for index in inspector.get_indexes("geo_order_metrics_cache")
    }
    for name in ("ix_geo_order_metrics_city", "ix_geo_order_metrics_state"):
        if name in indexes:
            op.drop_index(name, table_name="geo_order_metrics_cache")
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
