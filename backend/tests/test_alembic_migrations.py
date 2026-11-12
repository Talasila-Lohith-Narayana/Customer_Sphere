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
            ).scalar_one() == "20261112_0011"
            assert {"assistant_chat_sessions", "assistant_chat_turns"}.issubset(
                inspector.get_table_names()
            )
            assert "assistant_pending_actions" in inspector.get_table_names()
            assert {
                "id",
                "user_id",
                "action_type",
                "payload",
                "summary",
                "status",
                "created_at",
                "expires_at",
                "completed_at",
            }.issubset(
                {
                    column["name"]
                    for column in inspector.get_columns("assistant_pending_actions")
                }
            )
            assert {
                "user_id",
                "question",
                "answer",
                "visualizations",
                "created_at",
                "session_id",
            }.issubset(
                {
                    column["name"]
                    for column in inspector.get_columns("assistant_chat_turns")
                }
            )
            assert {
                "title",
                "created_at",
                "updated_at",
            }.issubset(
                {
                    column["name"]
                    for column in inspector.get_columns("assistant_chat_sessions")
                }
            )
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


def test_chat_session_migration_preserves_existing_turns(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'chat-history.db'}")
    try:
        with engine.begin() as connection:
            connection.execute(
                text(
                    "CREATE TABLE ci_users ("
                    "id INTEGER PRIMARY KEY, username VARCHAR(80) NOT NULL, "
                    "password_hash VARCHAR(255) NOT NULL, role VARCHAR(20) NOT NULL)"
                )
            )
            connection.execute(
                text(
                    "INSERT INTO ci_users (id, username, password_hash, role) "
                    "VALUES (7, 'chat-user', 'hash', 'viewer')"
                )
            )
            connection.execute(
                text(
                    "CREATE TABLE assistant_chat_turns ("
                    "id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, "
                    "question TEXT NOT NULL, answer TEXT NOT NULL, "
                    "visualizations TEXT NOT NULL, created_at DATETIME NOT NULL)"
                )
            )
            connection.execute(
                text(
                    "INSERT INTO assistant_chat_turns "
                    "(id, user_id, question, answer, visualizations, created_at) "
                    "VALUES (1, 7, 'Old question', 'Old answer', '[]', "
                    "'2026-11-10 10:00:00')"
                )
            )
            connection.execute(
                text(
                    "CREATE TABLE alembic_version "
                    "(version_num VARCHAR(32) NOT NULL PRIMARY KEY)"
                )
            )
            connection.execute(
                text("INSERT INTO alembic_version (version_num) VALUES ('20261110_0009')")
            )

            _upgrade(connection)

            migrated = connection.execute(
                text(
                    "SELECT s.title, t.session_id, t.question, t.answer "
                    "FROM assistant_chat_turns t "
                    "JOIN assistant_chat_sessions s ON s.id = t.session_id "
                    "WHERE t.id = 1"
                )
            ).one()
            assert migrated.title == "Previous chat"
            assert migrated.session_id is not None
            assert migrated.question == "Old question"
            assert migrated.answer == "Old answer"
    finally:
        engine.dispose()
