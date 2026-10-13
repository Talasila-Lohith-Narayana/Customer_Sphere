from app.models import AppUser


def ensure_bootstrap_users(
    db,
    *,
    enabled: bool,
    admin_username: str,
    admin_password: str,
    viewer_username: str,
    viewer_password: str,
    password_hasher,
) -> None:
    """Create default accounts when missing. Never change an existing user's role."""
    if not enabled:
        return

    if db.query(AppUser).filter_by(username=admin_username).first() is None:
        db.add(
            AppUser(
                username=admin_username,
                password_hash=password_hasher.hash(admin_password),
                role="admin",
            )
        )
        db.commit()

    if db.query(AppUser).filter_by(username=viewer_username).first() is None:
        db.add(
            AppUser(
                username=viewer_username,
                password_hash=password_hasher.hash(viewer_password),
                role="viewer",
            )
        )
        db.commit()
