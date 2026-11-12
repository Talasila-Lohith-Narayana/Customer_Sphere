"""Add one-time confirmed actions for Nova.

Revision ID: 20261112_0011
Revises: 20261110_0010
Create Date: 2026-11-12
"""
from alembic import op
import sqlalchemy as sa


revision = "20261112_0011"
down_revision = "20261110_0010"
branch_labels = None
depends_on = None


def upgrade() -> None:
    connection = op.get_bind()
    inspector = sa.inspect(connection)
    if "assistant_pending_actions" not in inspector.get_table_names():
        op.create_table(
            "assistant_pending_actions",
            sa.Column("id", sa.String(64), primary_key=True),
            sa.Column(
                "user_id",
                sa.Integer(),
                sa.ForeignKey("ci_users.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("action_type", sa.String(40), nullable=False),
            sa.Column("payload", sa.Text(), nullable=False),
            sa.Column("summary", sa.Text(), nullable=False),
            sa.Column(
                "status",
                sa.String(20),
                nullable=False,
                server_default="pending",
            ),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("expires_at", sa.DateTime(), nullable=False),
            sa.Column("completed_at", sa.DateTime(), nullable=True),
        )
    indexes = {
        index["name"]
        for index in sa.inspect(connection).get_indexes("assistant_pending_actions")
    }
    if "ix_assistant_pending_actions_user_id" not in indexes:
        op.create_index(
            "ix_assistant_pending_actions_user_id", "assistant_pending_actions", ["user_id"]
        )


def downgrade() -> None:
    if "assistant_pending_actions" in sa.inspect(op.get_bind()).get_table_names():
        op.drop_table("assistant_pending_actions")
