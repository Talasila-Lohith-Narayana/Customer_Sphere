"""Create application tables and add auth session columns.

Revision ID: 20261023_0001
Revises:
Create Date: 2026-10-23

This baseline is safe to run on both fresh databases and databases where the
application previously created its tables at startup. Downgrade is intentionally
non-destructive because this revision may adopt tables that already contain data.
"""
from alembic import op
import sqlalchemy as sa

from app.models import Base

revision = "20261023_0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    connection = op.get_bind()
    Base.metadata.create_all(bind=connection, checkfirst=True)

    user_columns = {
        column["name"] for column in sa.inspect(connection).get_columns("ci_users")
    }
    if "access_pages" not in user_columns:
        op.add_column(
            "ci_users",
            sa.Column("access_pages", sa.Text(), nullable=True),
        )
    if "token_version" not in user_columns:
        op.add_column(
            "ci_users",
            sa.Column(
                "token_version",
                sa.Integer(),
                nullable=False,
                server_default=sa.text("0"),
            ),
        )


def downgrade() -> None:
    # This baseline may mark pre-existing tables that contain user data.
    pass
