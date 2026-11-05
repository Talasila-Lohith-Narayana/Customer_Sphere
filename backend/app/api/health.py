from fastapi import APIRouter
from fastapi.responses import JSONResponse
from redis.exceptions import RedisError
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from app.api.auth.login_rate_limit import login_attempt_limiter
from app.core.config import RATE_LIMIT_REDIS_URL
from app.core.database import engine

router = APIRouter(tags=["health"])


@router.get("/health/live", include_in_schema=False)
def liveness():
    return {"status": "ok"}


@router.get("/health/ready", include_in_schema=False)
def readiness():
    checks = {"database": "ok"}
    try:
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))
    except SQLAlchemyError:
        checks["database"] = "unavailable"

    if RATE_LIMIT_REDIS_URL:
        checks["redis"] = "ok"
        try:
            login_attempt_limiter.check_connection()
        except RedisError:
            checks["redis"] = "unavailable"

    ready = all(value == "ok" for value in checks.values())
    return JSONResponse(
        status_code=200 if ready else 503,
        content={"status": "ok" if ready else "not_ready", "checks": checks},
    )
