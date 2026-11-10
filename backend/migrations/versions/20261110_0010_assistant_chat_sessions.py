"""Add independent assistant chat sessions.

Revision ID: 20261110_0010
Revises: 20261110_0009
Create Date: 2026-11-10
"""
from datetime import datetime, timezone

from alembic import op
import sqlalchemy as sa


revision = "20261110_0010"
down_revision = "20261110_0009"
branch_labels = None
depends_on = None


def upgrade() -> None:
    connection = op.get_bind()
    inspector = sa.inspect(connection)
    if "assistant_chat_sessions" not in inspector.get_table_names():
        op.create_table(
            "assistant_chat_sessions",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column(
                "user_id",
                sa.Integer(),
                sa.ForeignKey("ci_users.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column(
                "title",
                sa.String(120),
                nullable=False,
                server_default="New chat",
            ),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=False),
        )

    session_indexes = {
        index["name"]
        for index in sa.inspect(connection).get_indexes("assistant_chat_sessions")
    }
    if "ix_assistant_chat_sessions_user_id" not in session_indexes:
        op.create_index(
            "ix_assistant_chat_sessions_user_id",
            "assistant_chat_sessions",
            ["user_id"],
        )

    turn_columns = {
        column["name"]
        for column in sa.inspect(connection).get_columns("assistant_chat_turns")
    }
    if "session_id" not in turn_columns:
        session_column = sa.Column(
            "session_id",
            sa.Integer(),
            sa.ForeignKey(
                "assistant_chat_sessions.id",
                name="fk_assistant_chat_turns_session_id",
                ondelete="CASCADE",
            ),
            nullable=True,
        )
        if connection.dialect.name == "sqlite":
            with op.batch_alter_table("assistant_chat_turns") as batch_op:
                batch_op.add_column(session_column)
        else:
            op.add_column("assistant_chat_turns", session_column)

    turn_indexes = {
        index["name"]
        for index in sa.inspect(connection).get_indexes("assistant_chat_turns")
    }
    if "ix_assistant_chat_turns_session_id" not in turn_indexes:
        op.create_index(
            "ix_assistant_chat_turns_session_id",
            "assistant_chat_turns",
            ["session_id"],
        )

    turns = sa.table(
        "assistant_chat_turns",
        sa.column("id", sa.Integer()),
        sa.column("user_id", sa.Integer()),
        sa.column("session_id", sa.Integer()),
    )
    sessions = sa.table(
        "assistant_chat_sessions",
        sa.column("id", sa.Integer()),
        sa.column("user_id", sa.Integer()),
        sa.column("title", sa.String(120)),
        sa.column("created_at", sa.DateTime()),
        sa.column("updated_at", sa.DateTime()),
    )
    users_with_legacy_turns = connection.execute(
        sa.select(turns.c.user_id)
        .where(turns.c.session_id.is_(None))
        .distinct()
    ).scalars().all()
    for user_id in users_with_legacy_turns:
        now = datetime.now(timezone.utc).replace(tzinfo=None)
        result = connection.execute(
            sa.insert(sessions).values(
                user_id=user_id,
                title="Previous chat",
                created_at=now,
                updated_at=now,
            )
        )
        session_id = result.lastrowid
        if session_id is None:
            session_id = connection.execute(
                sa.select(sa.func.max(sessions.c.id)).where(
                    sessions.c.user_id == user_id
                )
            ).scalar_one()
        connection.execute(
            sa.update(turns)
            .where(turns.c.user_id == user_id, turns.c.session_id.is_(None))
            .values(session_id=session_id)
        )


def downgrade() -> None:
    connection = op.get_bind()
    if "assistant_chat_turns" in sa.inspect(connection).get_table_names():
        indexes = {
            index["name"]
            for index in sa.inspect(connection).get_indexes("assistant_chat_turns")
        }
        if "ix_assistant_chat_turns_session_id" in indexes:
            op.drop_index(
                "ix_assistant_chat_turns_session_id",
                table_name="assistant_chat_turns",
            )
        with op.batch_alter_table("assistant_chat_turns") as batch_op:
            batch_op.drop_column("session_id")

    if "assistant_chat_sessions" in sa.inspect(connection).get_table_names():
        op.drop_table("assistant_chat_sessions")
