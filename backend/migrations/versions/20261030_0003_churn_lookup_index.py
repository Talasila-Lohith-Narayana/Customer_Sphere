"""Index churn predictions by customer for directory lookups.

Revision ID: 20261030_0003
Revises: 20261030_0002
Create Date: 2026-10-30
"""
from alembic import op

from app.core.database import ANALYTICS_DB_NAME


revision = "20261030_0003"
down_revision = "20261030_0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if op.get_bind().dialect.name == "sqlite":
        return
    op.create_index(
        "ix_churn_predictions_customer_probability",
        "churn_predictions",
        ["customer_unique_id", "churn_probability"],
        schema=ANALYTICS_DB_NAME,
        mysql_length={"customer_unique_id": 64},
    )


def downgrade() -> None:
    if op.get_bind().dialect.name == "sqlite":
        return
    op.drop_index(
        "ix_churn_predictions_customer_probability",
        table_name="churn_predictions",
        schema=ANALYTICS_DB_NAME,
    )
