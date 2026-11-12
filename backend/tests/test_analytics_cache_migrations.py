from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path
from types import SimpleNamespace

import pytest


MIGRATIONS_DIR = (
    Path(__file__).resolve().parents[1]
    / "migrations"
    / "versions"
)
MIGRATION_FILES = (
    "20261030_0004_product_metrics_cache.py",
    "20261030_0005_geo_order_metrics_cache.py",
    "20261030_0006_geo_payment_count.py",
    "20261030_0007_cover_geo_metrics_indexes.py",
    "20261030_0008_cover_analytics_queries.py",
)


def _load_migration(filename):
    path = MIGRATIONS_DIR / filename
    spec = spec_from_file_location(path.stem, path)
    module = module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.mark.parametrize("filename", MIGRATION_FILES)
def test_analytics_migration_skips_when_dataset_tables_are_missing(
    monkeypatch,
    filename,
):
    migration = _load_migration(filename)
    operations = []
    connection = SimpleNamespace(dialect=SimpleNamespace(name="mysql"))
    inspector = SimpleNamespace(
        get_table_names=lambda: [],
        get_columns=lambda _table: [],
        get_indexes=lambda _table: [],
    )

    monkeypatch.setattr(migration.op, "get_bind", lambda: connection)
    monkeypatch.setattr(migration.sa, "inspect", lambda _connection: inspector)
    for operation in ("execute", "create_index", "drop_index", "add_column", "drop_column"):
        monkeypatch.setattr(
            migration.op,
            operation,
            lambda *args, _operation=operation, **kwargs: operations.append(
                (_operation, args, kwargs)
            ),
        )

    migration.upgrade()

    assert operations == []
