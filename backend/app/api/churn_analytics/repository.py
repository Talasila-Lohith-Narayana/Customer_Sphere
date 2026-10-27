from __future__ import annotations

import os
import threading
import time
from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.database import ANALYTICS_DB_NAME, engine

ANALYTICS_SCHEMA = ANALYTICS_DB_NAME
PREDICTIONS_TABLE = f"{ANALYTICS_SCHEMA}.churn_predictions"
RISK_TABLE = f"{ANALYTICS_SCHEMA}.customer_risk_tiers"
PREDICTION_VALUES_CACHE_TTL = float(
    os.getenv("CHURN_PREDICTION_CACHE_TTL_SECONDS", "30")
)
CHURN_OVERVIEW_CACHE_TTL = float(
    os.getenv("CHURN_OVERVIEW_CACHE_TTL_SECONDS", "30")
)

_prediction_values_cache: tuple[float, list[dict[str, Any]]] | None = None
_prediction_values_lock = threading.Lock()
_churn_overview_cache: tuple[float, dict[str, Any]] | None = None
_churn_overview_lock = threading.Lock()

def fetch_all(
    sql: str,
    params: dict[str, Any] | None = None,
    db: Session | None = None,
) -> list[dict[str, Any]]:
    if db is not None:
        rows = db.execute(text(sql), params or {}).mappings().all()
    else:
        with engine.connect() as connection:
            rows = connection.execute(text(sql), params or {}).mappings().all()
    return [dict(row) for row in rows]


def fetch_one(
    sql: str,
    params: dict[str, Any] | None = None,
    db: Session | None = None,
) -> dict[str, Any] | None:
    rows = fetch_all(sql, params, db)
    return rows[0] if rows else None


def churn_summary(threshold: float, db: Session | None = None) -> dict[str, Any]:
    return fetch_one(
        f"""
        SELECT COUNT(*) AS total_customers,
               AVG(customer_prediction.churn_probability) AS avg_churn_probability,
               SUM(CASE WHEN customer_prediction.churn_probability >= :threshold THEN 1 ELSE 0 END)
                   AS predicted_churn_customers,
               MAX(customer_prediction.refreshed_at) AS refreshed_at
        FROM (
            SELECT customer_unique_id,
                   MAX(churn_probability) AS churn_probability,
                   MAX(scored_at) AS refreshed_at
            FROM {PREDICTIONS_TABLE}
            GROUP BY customer_unique_id
        ) customer_prediction
        """,
        {"threshold": threshold},
        db,
    ) or {}


def prediction_values(db: Session | None = None) -> list[dict[str, Any]]:
    global _prediction_values_cache

    with _prediction_values_lock:
        now = time.monotonic()
        if (
            PREDICTION_VALUES_CACHE_TTL > 0
            and _prediction_values_cache is not None
            and now - _prediction_values_cache[0] < PREDICTION_VALUES_CACHE_TTL
        ):
            return _prediction_values_cache[1]

        rows = fetch_all(
            f"SELECT churn_probability, shap_values, reason_codes FROM {PREDICTIONS_TABLE}",
            db=db,
        )
        _prediction_values_cache = (
            (now, rows) if PREDICTION_VALUES_CACHE_TTL > 0 else None
        )
        return rows


def clear_prediction_values_cache() -> None:
    global _prediction_values_cache
    global _churn_overview_cache

    with _prediction_values_lock:
        _prediction_values_cache = None
    with _churn_overview_lock:
        _churn_overview_cache = None


def cached_churn_overview(loader) -> dict[str, Any]:
    global _churn_overview_cache

    with _churn_overview_lock:
        now = time.monotonic()
        if (
            CHURN_OVERVIEW_CACHE_TTL > 0
            and _churn_overview_cache is not None
            and now - _churn_overview_cache[0] < CHURN_OVERVIEW_CACHE_TTL
        ):
            return _churn_overview_cache[1]

        overview = loader()
        _churn_overview_cache = (
            (now, overview) if CHURN_OVERVIEW_CACHE_TTL > 0 else None
        )
        return overview


def probability_distribution(db: Session | None = None) -> list[dict[str, Any]]:
    return fetch_all(
        f"""
        SELECT
            CASE
                WHEN churn_probability BETWEEN 0 AND 1
                    THEN LEAST(FLOOR(churn_probability * 10), 9)
                ELSE NULL
            END AS probability_bin,
            COUNT(*) AS customer_count
        FROM {PREDICTIONS_TABLE}
        GROUP BY probability_bin
        """,
        db=db,
    )


def prediction_for_customer(
    customer_unique_id: str,
    db: Session | None = None,
) -> dict[str, Any] | None:
    return fetch_one(
        f"""
        SELECT customer_unique_id, churn_probability, shap_values, reason_codes,
               model_version, scored_at
        FROM {PREDICTIONS_TABLE}
        WHERE customer_unique_id = :customer_unique_id
        ORDER BY scored_at DESC
        LIMIT 1
        """,
        {"customer_unique_id": customer_unique_id},
        db,
    )


def risk_for_customer(
    customer_unique_id: str,
    db: Session | None = None,
) -> dict[str, Any] | None:
    return fetch_one(
        f"""
        SELECT r.customer_unique_id, r.risk_tier, p.churn_probability
        FROM {RISK_TABLE} r
        LEFT JOIN {PREDICTIONS_TABLE} p
               ON p.customer_unique_id = r.customer_unique_id
        WHERE r.customer_unique_id = :customer_unique_id
        ORDER BY p.scored_at DESC
        LIMIT 1
        """,
        {"customer_unique_id": customer_unique_id},
        db,
    )


def last_refresh(db: Session | None = None) -> dict[str, Any] | None:
    return fetch_one(
        f"SELECT MAX(scored_at) AS last_refreshed_at FROM {PREDICTIONS_TABLE}",
        db=db,
    )
