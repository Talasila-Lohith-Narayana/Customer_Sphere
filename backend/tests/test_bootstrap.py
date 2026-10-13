from types import SimpleNamespace
from unittest.mock import MagicMock

from app.core.bootstrap import ensure_bootstrap_users
from app.models import AppUser


class _FakeHasher:
    def hash(self, password):
        return f"hashed:{password}"


def _query_result(existing_usernames):
    def filter_by(username):
        found = username in existing_usernames
        result = MagicMock()
        result.first.return_value = (
            SimpleNamespace(username=username, role="viewer") if found else None
        )
        return result

    query = MagicMock()
    query.filter_by.side_effect = lambda **kwargs: filter_by(kwargs["username"])
    return query


def test_ensure_bootstrap_users_does_nothing_when_disabled():
    db = MagicMock()
    ensure_bootstrap_users(
        db,
        enabled=False,
        admin_username="admin",
        admin_password="admin-secret",
        viewer_username="analyst",
        viewer_password="viewer-secret",
        password_hasher=_FakeHasher(),
    )
    db.query.assert_not_called()
    db.add.assert_not_called()
    db.commit.assert_not_called()


def test_ensure_bootstrap_users_creates_missing_accounts_only():
    db = MagicMock()
    db.query.return_value = _query_result(set())

    ensure_bootstrap_users(
        db,
        enabled=True,
        admin_username="admin",
        admin_password="admin-secret",
        viewer_username="analyst",
        viewer_password="viewer-secret",
        password_hasher=_FakeHasher(),
    )

    added_roles = {call.args[0].role for call in db.add.call_args_list}
    added_usernames = {call.args[0].username for call in db.add.call_args_list}
    assert added_usernames == {"admin", "analyst"}
    assert added_roles == {"admin", "viewer"}
    assert db.commit.call_count == 2
    assert all(isinstance(call.args[0], AppUser) for call in db.add.call_args_list)


def test_ensure_bootstrap_users_does_not_overwrite_existing_roles():
    db = MagicMock()
    db.query.return_value = _query_result({"admin", "analyst"})

    ensure_bootstrap_users(
        db,
        enabled=True,
        admin_username="admin",
        admin_password="admin-secret",
        viewer_username="analyst",
        viewer_password="viewer-secret",
        password_hasher=_FakeHasher(),
    )

    db.add.assert_not_called()
    db.commit.assert_not_called()
