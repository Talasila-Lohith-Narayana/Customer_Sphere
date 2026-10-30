from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, inspect, text


MIGRATIONS_DIR = Path(__file__).resolve().parents[1]


def _upgrade(connection):
    config = Config(str(MIGRATIONS_DIR / "alembic.ini"))
    config.attributes["connection"] = connection
    command.upgrade(config, "head")


def test_initial_migration_creates_application_tables(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'fresh.db'}")
    try:
        with engine.begin() as connection:
            _upgrade(connection)
            inspector = inspect(connection)

            assert {"ci_users", "consumer_interactions", "audit_logs"}.issubset(
                inspector.get_table_names()
            )
            assert {
                "access_pages",
                "token_version",
            }.issubset(
                {column["name"] for column in inspector.get_columns("ci_users")}
            )
            assert connection.execute(
                text("SELECT version_num FROM alembic_version")
            ).scalar_one() == "20261030_0003"
            assert "ix_customer_metrics_cache_frequency_customer_unique_id" in {
                index["name"] for index in inspector.get_indexes("customer_metrics_cache")
            }
    finally:
        engine.dispose()


def test_initial_migration_adopts_existing_user_table_without_dropping_data(
    tmp_path,
):
    engine = create_engine(f"sqlite:///{tmp_path / 'existing.db'}")
    try:
        with engine.begin() as connection:
            connection.execute(
                text(
                    "CREATE TABLE ci_users ("
                    "id INTEGER PRIMARY KEY, "
                    "username VARCHAR(80) NOT NULL, "
                    "password_hash VARCHAR(255) NOT NULL, "
                    "role VARCHAR(20) NOT NULL)"
                )
            )
            connection.execute(
                text(
                    "INSERT INTO ci_users (id, username, password_hash, role) "
                    "VALUES (1, 'existing-user', 'test-hash', 'viewer')"
                )
            )

            _upgrade(connection)

            user = connection.execute(
                text(
                    "SELECT username, password_hash, role, access_pages, token_version "
                    "FROM ci_users WHERE id = 1"
                )
            ).one()
            assert user.username == "existing-user"
            assert user.password_hash == "test-hash"
            assert user.role == "viewer"
            assert user.access_pages is None
            assert user.token_version == 0
            assert {"consumer_interactions", "audit_logs"}.issubset(
                inspect(connection).get_table_names()
            )
    finally:
        engine.dispose()
