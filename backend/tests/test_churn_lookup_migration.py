from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path
from types import SimpleNamespace


MIGRATION_FILE = (
    Path(__file__).resolve().parents[1]
    / "migrations"
    / "versions"
    / "20261030_0003_churn_lookup_index.py"
)


def _load_migration_module():
    spec = spec_from_file_location("migration_20261030_0003", MIGRATION_FILE)
    module = module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_upgrade_skips_index_creation_when_churn_predictions_table_missing(monkeypatch):
    migration = _load_migration_module()
    create_index_calls = []
    fake_bind = SimpleNamespace(dialect=SimpleNamespace(name="mysql"))

    monkeypatch.setattr(migration.op, "get_bind", lambda: fake_bind)
    monkeypatch.setattr(
        migration.sa,
        "inspect",
        lambda _connection: SimpleNamespace(
            get_table_names=lambda schema=None: {"orders", "customers"}
        ),
    )
    monkeypatch.setattr(
        migration.op,
        "create_index",
        lambda *args, **kwargs: create_index_calls.append((args, kwargs)),
    )

    migration.upgrade()

    assert create_index_calls == []


def test_upgrade_creates_index_when_churn_predictions_table_exists(monkeypatch):
    migration = _load_migration_module()
    create_index_calls = []
    fake_bind = SimpleNamespace(dialect=SimpleNamespace(name="mysql"))

    monkeypatch.setattr(migration.op, "get_bind", lambda: fake_bind)
    monkeypatch.setattr(
        migration.sa,
        "inspect",
        lambda _connection: SimpleNamespace(
            get_table_names=lambda schema=None: {"churn_predictions"}
        ),
    )
    monkeypatch.setattr(
        migration.op,
        "create_index",
        lambda *args, **kwargs: create_index_calls.append((args, kwargs)),
    )

    migration.upgrade()

    assert create_index_calls == [
        (
            (
                "ix_churn_predictions_customer_probability",
                "churn_predictions",
                ["customer_unique_id", "churn_probability"],
            ),
            {
                "schema": migration.ANALYTICS_DB_NAME,
                "mysql_length": {"customer_unique_id": 64},
            },
        )
    ]
