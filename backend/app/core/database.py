import os
from contextlib import contextmanager

from dotenv import load_dotenv
from sqlalchemy import create_engine
from sqlalchemy.engine import URL
from sqlalchemy.orm import sessionmaker

# Load environment variables from .env file
load_dotenv()

DB_NAME = os.getenv("DB_NAME", "olist")
ANALYTICS_DB_NAME = os.getenv("ANALYTICS_DB_NAME", "customer_intelligence")
APP_DB_USER = os.getenv("DB_USER", "root").strip()

# Build MySQL connection URL from environment variables with safe defaults
DATABASE_URL = URL.create(
    drivername="mysql+pymysql",
    username=APP_DB_USER,
    password=os.getenv("DB_PASSWORD", ""),
    host=os.getenv("DB_HOST", "localhost"),
    port=int(os.getenv("DB_PORT", "3306")),
    database=DB_NAME,
)

# SQLAlchemy Engine with connection health checks and automatic pool recycling
engine = create_engine(
    DATABASE_URL,
    pool_pre_ping=True,
    pool_recycle=1800,
)

# Session factory for generating isolated database sessions per request
SessionLocal = sessionmaker(
    bind=engine,
    autoflush=False,
    autocommit=False,
)

NOVA_READONLY_DB_USER = os.getenv("NOVA_READONLY_DB_USER", "").strip()
NOVA_READONLY_DB_PASSWORD = os.getenv("NOVA_READONLY_DB_PASSWORD", "")
NOVA_READONLY_DATABASE_URL = (
    URL.create(
        drivername="mysql+pymysql",
        username=NOVA_READONLY_DB_USER,
        password=NOVA_READONLY_DB_PASSWORD,
        host=os.getenv("NOVA_READONLY_DB_HOST", os.getenv("DB_HOST", "localhost")),
        port=int(os.getenv("NOVA_READONLY_DB_PORT", os.getenv("DB_PORT", "3306"))),
        database=os.getenv("NOVA_READONLY_DB_NAME", DB_NAME),
    )
    if (
        NOVA_READONLY_DB_USER
        and NOVA_READONLY_DB_PASSWORD
        and NOVA_READONLY_DB_USER != APP_DB_USER
    )
    else None
)
nova_readonly_engine = (
    create_engine(
        NOVA_READONLY_DATABASE_URL,
        pool_pre_ping=True,
        pool_recycle=1800,
    )
    if NOVA_READONLY_DATABASE_URL
    else None
)
NovaReadonlySessionLocal = (
    sessionmaker(
        bind=nova_readonly_engine,
        autoflush=False,
        autocommit=False,
    )
    if nova_readonly_engine
    else None
)


def get_db():
    """
    FastAPI dependency that yields a SQLAlchemy database session per request
    and ensures the session is properly closed once the request finishes.
    """
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def is_nova_readonly_db_configured() -> bool:
    return NovaReadonlySessionLocal is not None


@contextmanager
def get_nova_readonly_db():
    if NovaReadonlySessionLocal is None:
        raise RuntimeError(
            "Set NOVA_READONLY_DB_USER to enable generated analytics queries."
        )
    db = NovaReadonlySessionLocal()
    try:
        yield db
    finally:
        db.close()
