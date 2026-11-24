from fastapi import Depends, HTTPException, Request
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
import jwt
from sqlalchemy.orm import Session
from app.core.auth_cookies import ACCESS_TOKEN_COOKIE, validate_csrf_request
from app.core.database import get_db
from app.models import AppUser
from app.core.permissions import get_user_access_pages
from .config import SECRET, ALGO

# Extract bearer token from HTTP request header
security = HTTPBearer(auto_error=False)

def auth(
    request: Request,
    c: HTTPAuthorizationCredentials | None = Depends(security),
    db: Session = Depends(get_db),
):
    """
    Standard Login Check:
    Verifies that the user has a valid active login token.
    Used by ALL read and write endpoints across the app.
    """
    token = c.credentials if c else request.cookies.get(ACCESS_TOKEN_COOKIE)
    if not token:
        raise HTTPException(401, "Invalid or expired token. Please log in again.")
    if c is None:
        validate_csrf_request(request)

    try:
        payload = jwt.decode(token, SECRET, algorithms=[ALGO])
    except (jwt.PyJWTError, KeyError):
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
        "user_id": account.id,
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
