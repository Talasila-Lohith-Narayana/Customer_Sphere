"""Add a covering index for dashboard repeat-customer counts.

Revision ID: 20261030_0002
Revises: 20261023_0001
Create Date: 2026-10-30
"""
from alembic import op


revision = "20261030_0002"
down_revision = "20261023_0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_index(
        "ix_customer_metrics_cache_frequency_customer_unique_id",
        "customer_metrics_cache",
        ["frequency", "customer_unique_id"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_customer_metrics_cache_frequency_customer_unique_id",
        table_name="customer_metrics_cache",
    )
