import os
import time
import logging
import uuid
from contextlib import asynccontextmanager
from fastapi import Depends, FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException
from jose import jwt, JWTError

from .core.api_responses import error_payload, http_error_code, json_safe

from .core.bootstrap import ensure_bootstrap_users
from .core.config import (
    ADMIN_USERNAME,
    ADMIN_PASSWORD,
    ALLOW_BOOTSTRAP_USERS,
    VIEWER_USERNAME,
    VIEWER_PASSWORD,
    RATE_LIMIT_REDIS_URL,
    SECRET,
    ALGO,
    pwd,
)
from .core.database import SessionLocal, engine
from .api.auth.login_rate_limit import (
    RedisLoginAttemptLimiter,
    login_attempt_limiter,
)
from .core.permissions import (
    require_campaign_data_access,
    require_clv_delivery_access,
    require_customer_analytics_access,
    require_audit_access,
    require_any_page_access,
    require_page_access,
    require_products_area_access,
)
# Import all domain API routers
from .api.auth.router import router as auth_router
from .api.dashboard.router import router as dashboard_router
from .api.customers.router import router as customers_router
from .api.orders.router import router as orders_router
from .api.products.router import router as products_router
from .api.reviews.router import router as reviews_router
from .api.interactions.router import router as interactions_router
from .api.audit_logs.router import router as audit_logs_router
from .api.predictions.router import router as predictions_router
from .api.churn_analytics.router import router as churn_analytics_router

# Analytics routers are mounted beneath a dedicated prefix so their paths do
# not overlap the existing customer/dashboard APIs.
from .api.campaigns_forecast.router import router as campaigns_forecast_router
from .api.cohort_trends.router import router as cohort_trend_router
from .api.clv_delivery_payments.router import router as clv_router
from .api.model_evaluation.router import router as model_evaluation_router


# ------------------------------------------------------------------------------
# Application Lifespan Event (Table Checks, Admin/Analyst Users & Cache Setup)
# ------------------------------------------------------------------------------
@asynccontextmanager
async def lifespan(app: FastAPI):
    if RATE_LIMIT_REDIS_URL:
        if not isinstance(login_attempt_limiter, RedisLoginAttemptLimiter):
            raise RuntimeError("Redis login rate limiting is not configured correctly.")
        login_attempt_limiter.check_connection()
    # Default users are created only when missing. Existing roles are left unchanged
    # so a restart cannot demote or promote an account that an administrator edited.
    with SessionLocal() as db:
        ensure_bootstrap_users(
            db,
            enabled=ALLOW_BOOTSTRAP_USERS,
            admin_username=ADMIN_USERNAME,
            admin_password=ADMIN_PASSWORD,
            viewer_username=VIEWER_USERNAME,
            viewer_password=VIEWER_PASSWORD,
            password_hasher=pwd,
        )
    yield


app = FastAPI(title="Customer Sphere API", lifespan=lifespan)

# Configure structured request logger
logger = logging.getLogger("customer_sphere")
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)


@app.exception_handler(StarletteHTTPException)
async def http_exception_handler(request: Request, exc: StarletteHTTPException):
    detail = json_safe(exc.detail)
    payload = error_payload(http_error_code(exc.status_code), "Request failed", detail)
    if isinstance(detail, str):
        payload["detail"] = detail
        payload["error"]["message"] = detail
    elif isinstance(detail, (list, dict)):
        payload["detail"] = detail
    # Preserve headers set by the raiser (e.g. Retry-After on 429, WWW-Authenticate on 401).
    return JSONResponse(
        status_code=exc.status_code,
        content=payload,
        headers=getattr(exc, "headers", None),
    )


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    details = json_safe(exc.errors())
    payload = error_payload(
        http_error_code(422),
        "Validation failed",
        details,
    )
    payload["detail"] = details
    return JSONResponse(status_code=422, content=payload)


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    logger.exception("Unhandled application error for %s %s", request.method, request.url.path)
    payload = error_payload(
        http_error_code(500),
        "An unexpected error occurred.",
        None,
    )
    payload["detail"] = "An unexpected error occurred."
    return JSONResponse(status_code=500, content=payload)


# ------------------------------------------------------------------------------
# Request Logging Middleware — logs method, path, status, duration, user
# ------------------------------------------------------------------------------
@app.middleware("http")
async def request_logging_middleware(request: Request, call_next):
    start = time.perf_counter()
    request_id = str(uuid.uuid4())
    request.state.request_id = request_id
    response = await call_next(request)
    duration_ms = round((time.perf_counter() - start) * 1000, 1)
    response.headers["X-Request-ID"] = request_id

    # Extract username from JWT if present (best-effort, no auth enforcement)
    user = "anonymous"
    auth_header = request.headers.get("authorization", "")
    if auth_header.startswith("Bearer "):
        try:
            payload = jwt.decode(auth_header[7:], SECRET, algorithms=[ALGO])
            user = payload.get("sub", "unknown")
        except (JWTError, Exception):
            user = "invalid-token"

    logger.info(
        "%s %s | %s | %sms | user=%s | request_id=%s",
        request.method,
        request.url.path,
        response.status_code,
        duration_ms,
        user,
        request_id,
    )
    return response


# Enable CORS for frontend web client (configurable via CORS_ORIGINS env var)
_default_origins = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:3000",
]
_cors_origins_env = os.getenv("CORS_ORIGINS", "")
cors_origins = (
    [o.strip() for o in _cors_origins_env.split(",") if o.strip()]
    if _cors_origins_env
    else _default_origins
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["Retry-After"],
)

# Register all modular routers
app.include_router(auth_router)
app.include_router(
    dashboard_router,
    dependencies=[Depends(require_page_access("dashboard"))],
)
app.include_router(
    customers_router,
    dependencies=[Depends(require_page_access("customers"))],
)
app.include_router(
    orders_router,
    dependencies=[Depends(require_page_access("customers"))],
)
app.include_router(
    products_router,
    dependencies=[Depends(require_products_area_access())],
)
app.include_router(
    reviews_router,
    dependencies=[Depends(require_page_access("customers"))],
)
app.include_router(
    interactions_router,
    dependencies=[Depends(require_page_access("customers"))],
)
app.include_router(audit_logs_router)
app.include_router(
    predictions_router,
    dependencies=[Depends(require_page_access("customers"))],
)
app.include_router(churn_analytics_router, prefix="/api/analytics")
app.include_router(campaigns_forecast_router, prefix="/api/analytics")
app.include_router(cohort_trend_router, prefix="/api/analytics")
app.include_router(clv_router, prefix="/api/analytics")
app.include_router(model_evaluation_router, prefix="/api/analytics")
