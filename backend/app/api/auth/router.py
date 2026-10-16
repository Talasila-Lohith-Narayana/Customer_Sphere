from datetime import datetime, timedelta, timezone
import json
from fastapi import APIRouter, Depends, HTTPException, Request, status
from jose import jwt
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from app.core.config import SECRET, ALGO, TRUSTED_PROXY_HOSTS, pwd
from app.core.auth import admin_auth, auth
from app.core.database import get_db
from app.models import AppUser
from app.schemas import (
    Login,
    ProfileSummary,
    UserCreate,
    UserSummary,
    UserUpdate,
    UserUpdateResult,
)
from app.core.permissions import DEFAULT_VIEWER_ACCESS, get_user_access_pages
from app.api.auth.login_rate_limit import get_client_ip, login_attempt_limiter

router = APIRouter(tags=["auth"])

@router.post("/api/auth/login")
def login(x: Login, request: Request, db: Session = Depends(get_db)):
    """
    Authenticates username and password.
    Returns: JWT token, username, and role (admin or viewer/analyst).
    UI Component: Login page (`Login.jsx`).
    """
    client_host = get_client_ip(request, TRUSTED_PROXY_HOSTS)
    retry_after = login_attempt_limiter.retry_after(client_host)
    if retry_after is not None:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many failed login attempts. Try again later.",
            headers={"Retry-After": str(retry_after)},
        )

    u = db.query(AppUser).filter_by(username=x.username).first()
    if not u or not pwd.verify(x.password, u.password_hash):
        login_attempt_limiter.record_failure(client_host)
        raise HTTPException(401, "Invalid username or password")
    login_attempt_limiter.clear(client_host)
    token = jwt.encode(
        {
            "sub": u.username,
            "role": u.role,
            "token_version": u.token_version,
            "exp": datetime.now(timezone.utc) + timedelta(hours=8),
        },
        SECRET,
        algorithm=ALGO,
    )
    return {
        "access_token": token,
        "token_type": "bearer",
        "username": u.username,
        "role": u.role,
        "access_pages": get_user_access_pages(u),
    }


@router.get("/api/auth/users", response_model=list[UserSummary])
def list_users(
    db: Session = Depends(get_db),
    _: dict = Depends(admin_auth),
):
    users = db.query(AppUser).order_by(AppUser.username).all()
    return [
        {
            "username": user.username,
            "role": user.role,
            "access_pages": get_user_access_pages(user),
        }
        for user in users
    ]


@router.get("/api/auth/profiles", response_model=list[ProfileSummary])
def list_profiles(
    db: Session = Depends(get_db),
    _: dict = Depends(auth),
):
    users = db.query(AppUser).order_by(AppUser.username).all()
    return [{"username": user.username, "role": user.role} for user in users]


@router.get("/api/auth/session")
def validate_session(_: dict = Depends(auth)):
    return {"valid": True}


@router.post(
    "/api/auth/users",
    response_model=UserSummary,
    status_code=status.HTTP_201_CREATED,
)
def create_user(
    data: UserCreate,
    db: Session = Depends(get_db),
    _: dict = Depends(admin_auth),
):
    if db.query(AppUser).filter_by(username=data.username).first():
        raise HTTPException(status_code=409, detail="A user with this username already exists.")

    user = AppUser(
        username=data.username,
        password_hash=pwd.hash(data.password),
        role=data.role,
        access_pages=json.dumps(
            data.access_pages
            if data.access_pages is not None
            else list(DEFAULT_VIEWER_ACCESS)
        ),
    )
    db.add(user)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail="A user with this username already exists.",
        ) from exc
    db.refresh(user)
    return {
        "username": user.username,
        "role": user.role,
        "access_pages": get_user_access_pages(user),
    }


@router.patch("/api/auth/users/{username}", response_model=UserUpdateResult)
def update_user(
    username: str,
    data: UserUpdate,
    db: Session = Depends(get_db),
    requester: dict = Depends(admin_auth),
):
    user = db.query(AppUser).filter_by(username=username).first()
    if user is None:
        raise HTTPException(status_code=404, detail="User not found.")

    previous_access_pages = get_user_access_pages(user)
    renamed_username = data.username is not None and data.username != username
    if renamed_username:
        existing_user = db.query(AppUser).filter_by(username=data.username).first()
        if existing_user is not None:
            raise HTTPException(
                status_code=409,
                detail="A user with this username already exists.",
            )
        user.username = data.username

    if data.password is not None:
        user.password_hash = pwd.hash(data.password)

    if data.access_pages is not None:
        user.access_pages = json.dumps(data.access_pages)

    access_pages_changed = (
        data.access_pages is not None
        and set(get_user_access_pages(user)) != set(previous_access_pages)
    )
    sessions_revoked = data.password is not None or access_pages_changed
    if sessions_revoked:
        user.token_version += 1

    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail="A user with this username already exists.",
        ) from exc
    db.refresh(user)

    access_token = None
    if renamed_username and requester.get("sub") == username:
        access_token = jwt.encode(
            {
                "sub": user.username,
                "role": requester["role"],
                "token_version": user.token_version,
                "exp": requester["exp"],
            },
            SECRET,
            algorithm=ALGO,
        )
    return {
        "username": user.username,
        "role": user.role,
        "access_pages": get_user_access_pages(user),
        "access_token": access_token,
        "sessions_revoked": sessions_revoked,
    }


@router.delete("/api/auth/users/{username}", response_model=UserSummary)
def delete_user(
    username: str,
    db: Session = Depends(get_db),
    requester: dict = Depends(admin_auth),
):
    user = db.query(AppUser).filter_by(username=username).first()
    if user is None:
        raise HTTPException(status_code=404, detail="User not found.")
    if requester.get("sub") == username:
        raise HTTPException(
            status_code=409,
            detail="You cannot delete the account you are currently using.",
        )
    if user.role == "admin" and db.query(AppUser).filter_by(role="admin").count() <= 1:
        raise HTTPException(
            status_code=409,
            detail="The last administrator account cannot be deleted.",
        )

    deleted_user = {
        "username": user.username,
        "role": user.role,
        "access_pages": get_user_access_pages(user),
    }
    db.delete(user)
    db.commit()
    return deleted_user
