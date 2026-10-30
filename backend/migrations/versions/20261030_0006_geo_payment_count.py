"""Track paid orders in the geography summary.

Revision ID: 20261030_0006
Revises: 20261030_0005
Create Date: 2026-10-30
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import mysql


revision = "20261030_0006"
down_revision = "20261030_0005"
branch_labels = None
depends_on = None


def _update_payment_count(order_id: str) -> str:
    return f"""
        UPDATE geo_order_metrics_cache
        SET payment_count = (
            SELECT COUNT(*)
            FROM order_payments
            WHERE order_id = {order_id}
        )
        WHERE order_id = {order_id}
    """


def _create_trigger(name: str, timing: str, body: str) -> None:
    op.execute(
        f"CREATE TRIGGER {name} AFTER {timing} ON order_payments "
        f"FOR EACH ROW {body}"
    )


def upgrade() -> None:
    if op.get_bind().dialect.name == "sqlite":
        return

    op.add_column(
        "geo_order_metrics_cache",
        sa.Column(
            "payment_count",
            mysql.BIGINT(unsigned=True),
            nullable=False,
            server_default="0",
        ),
    )
    op.execute(
        """
        UPDATE geo_order_metrics_cache g
        SET payment_count = (
            SELECT COUNT(*)
            FROM order_payments p
            WHERE p.order_id = g.order_id
        )
        """
    )
    _create_trigger(
        "trg_geo_metrics_payment_count_ai",
        "INSERT",
        _update_payment_count("NEW.order_id"),
    )
    _create_trigger(
        "trg_geo_metrics_payment_count_au",
        "UPDATE",
        "BEGIN "
        + _update_payment_count("OLD.order_id")
        + "; "
        + _update_payment_count("NEW.order_id")
        + "; END",
    )
    _create_trigger(
        "trg_geo_metrics_payment_count_ad",
        "DELETE",
        _update_payment_count("OLD.order_id"),
    )


def downgrade() -> None:
    if op.get_bind().dialect.name == "sqlite":
        return

    for trigger in (
        "trg_geo_metrics_payment_count_ad",
        "trg_geo_metrics_payment_count_au",
        "trg_geo_metrics_payment_count_ai",
    ):
        op.execute(f"DROP TRIGGER IF EXISTS {trigger}")
    op.drop_column("geo_order_metrics_cache", "payment_count")
