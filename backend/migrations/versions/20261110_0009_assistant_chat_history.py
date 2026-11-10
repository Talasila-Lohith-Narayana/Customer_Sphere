"""Persist assistant chat turns per application user.

Revision ID: 20261110_0009
Revises: 20261030_0008
Create Date: 2026-11-10
"""
from alembic import op
import sqlalchemy as sa


revision = "20261110_0009"
down_revision = "20261030_0008"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if "assistant_chat_turns" not in sa.inspect(op.get_bind()).get_table_names():
        op.create_table(
            "assistant_chat_turns",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column(
                "user_id",
                sa.Integer(),
                sa.ForeignKey("ci_users.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("question", sa.Text(), nullable=False),
            sa.Column("answer", sa.Text(), nullable=False),
            sa.Column("visualizations", sa.Text(), nullable=False),
            sa.Column("created_at", sa.DateTime(), nullable=False),
        )

    indexes = {
        index["name"] for index in sa.inspect(op.get_bind()).get_indexes("assistant_chat_turns")
    }
    if "ix_assistant_chat_turns_user_id" not in indexes:
        op.create_index(
            "ix_assistant_chat_turns_user_id",
            "assistant_chat_turns",
            ["user_id"],
        )


def downgrade() -> None:
    if "assistant_chat_turns" in sa.inspect(op.get_bind()).get_table_names():
        op.drop_table("assistant_chat_turns")
