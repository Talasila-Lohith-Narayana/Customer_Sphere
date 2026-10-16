from fastapi import Depends, HTTPException
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import jwt, JWTError
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.models import AppUser
from app.core.permissions import get_user_access_pages
from .config import SECRET, ALGO

# Extract bearer token from HTTP request header
security = HTTPBearer()

def auth(
    c: HTTPAuthorizationCredentials = Depends(security),
    db: Session = Depends(get_db),
):
    """
    Standard Login Check:
    Verifies that the user has a valid active login token.
    Used by ALL read and write endpoints across the app.
    """
    try:
        payload = jwt.decode(c.credentials, SECRET, algorithms=[ALGO])
    except (JWTError, KeyError):
        raise HTTPException(401, "Invalid or expired token. Please log in again.")

    account = (
        db.query(AppUser)
        .filter_by(username=payload.get("sub"), role=payload.get("role"))
        .first()
    )
    if account is None or payload.get("token_version", 0) != account.token_version:
        raise HTTPException(401, "Invalid or expired token. Please log in again.")
    return {
        **payload,
        "role": account.role,
        "access_pages": get_user_access_pages(account),
    }


def admin_auth(user: dict = Depends(auth)):
    """
    Administrator Privilege Check:
    Verifies that the logged-in user has the 'admin' role.
    Used by ALL mutation buttons (Create, Edit, Delete, Bulk actions).
    """
    if user.get("role") != "admin":
        raise HTTPException(403, "Admin authorization required to modify data.")
    return user
