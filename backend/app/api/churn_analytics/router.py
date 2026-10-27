from __future__ import annotations

import json
import logging
from collections import Counter
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.api.churn_analytics import repository as repo
from app.api.predictions.router import REASON_CODE_MESSAGES
from app.core.database import get_db
from app.core.permissions import require_any_page_access, require_page

logger = logging.getLogger(__name__)
router = APIRouter(tags=["Churn Analytics"])


def _db(fn, *args, **kwargs):
    try:
        return fn(*args, **kwargs)
    except SQLAlchemyError as exc:
        logger.exception("Database error in %s", getattr(fn, "__name__", fn))
        raise HTTPException(
            status_code=503,
            detail="Analytics data is temporarily unavailable.",
        ) from exc


def _decode_json(value: Any, expected_type: type):
    if isinstance(value, expected_type):
        return value
    if isinstance(value, (bytes, bytearray)):
        value = value.decode("utf-8")
    if isinstance(value, str):
        try:
            decoded = json.loads(value)
        except (json.JSONDecodeError, TypeError):
            return expected_type()
        return decoded if isinstance(decoded, expected_type) else expected_type()
    return expected_type()


def _shap_records(db: Session) -> list[dict[str, float]]:
    records = []
    for row in _db(repo.prediction_values, db):
        values = _decode_json(row.get("shap_values"), dict)
        records.append({str(name): float(value) for name, value in values.items()})
    return records


def _churn_summary(threshold: float, db: Session) -> dict[str, Any]:
    result = _db(repo.churn_summary, threshold, db)
    total = int(result.get("total_customers") or 0)
    predicted = int(result.get("predicted_churn_customers") or 0)
    return {
        "total_customers": total,
        "avg_churn_probability": (
            float(result["avg_churn_probability"])
            if result.get("avg_churn_probability") is not None
            else None
        ),
        "predicted_churn_customers": predicted,
        "predicted_churn_rate": predicted / total if total else 0.0,
        "threshold": threshold,
        "refreshed_at": result.get("refreshed_at"),
    }


def _top_features(records: list[dict[str, float]], limit: int) -> dict[str, Any]:
    totals: Counter[str] = Counter()
    counts: Counter[str] = Counter()
    for record in records:
        for feature, value in record.items():
            if value > 0:
                totals[feature] += value
                counts[feature] += 1
    features = [
        {
            "feature": feature,
            "avg_positive_shap": totals[feature] / len(records),
            "customers_impacted": counts[feature],
        }
        for feature in totals
    ]
    features.sort(key=lambda item: item["avg_positive_shap"], reverse=True)
    return {"scored_customers": len(records), "features": features[:limit]}


def _global_feature_importance(
    records: list[dict[str, float]],
    limit: int,
) -> dict[str, Any]:
    totals: Counter[str] = Counter()
    counts: Counter[str] = Counter()
    for record in records:
        for feature, value in record.items():
            totals[feature] += abs(value)
            counts[feature] += 1
    features = [
        {
            "feature": feature,
            "mean_abs_shap": totals[feature] / len(records),
            "customers_present": counts[feature],
        }
        for feature in totals
    ]
    features.sort(key=lambda item: item["mean_abs_shap"], reverse=True)
    return {"scored_customers": len(records), "features": features[:limit]}


def _probability_distribution(db: Session) -> dict[str, Any]:
    rows = _db(repo.probability_distribution, db)
    bins = [
        {
            "range": f"{start / 10:.1f}-{(start + 1) / 10:.1f}",
            "min": start / 10,
            "max": (start + 1) / 10,
            "count": 0,
        }
        for start in range(10)
    ]
    for row in rows:
        probability_bin = row.get("probability_bin")
        if probability_bin is None:
            continue
        bins[int(probability_bin)]["count"] = int(row["customer_count"])
    return {
        "total_customers": sum(int(row["customer_count"]) for row in rows),
        "bins": bins,
    }


def _reason_codes_summary(db: Session) -> dict[str, Any]:
    counts: Counter[str] = Counter()
    for row in _db(repo.prediction_values, db):
        counts.update(_decode_json(row.get("reason_codes"), list))
    summary = [
        {
            "reason_code": code,
            "message": message,
            "count": counts[code],
        }
        for code, message in REASON_CODE_MESSAGES.items()
    ]
    summary.extend(
        {"reason_code": code, "message": "", "count": count}
        for code, count in counts.items()
        if code not in REASON_CODE_MESSAGES
    )
    summary.sort(key=lambda item: (-item["count"], item["reason_code"]))
    return {"total_reason_codes": sum(counts.values()), "reason_codes": summary}


@router.get("/churn/summary")
def churn_summary(
    db: Session = Depends(get_db),
    threshold: float = Query(0.7, ge=0, le=1),
    _: dict = Depends(require_page("model")),
) -> dict[str, Any]:
    return _churn_summary(threshold, db)


@router.get("/churn/overview")
def churn_overview(
    db: Session = Depends(get_db),
    _: dict = Depends(require_page("model")),
) -> dict[str, Any]:
    def load_overview() -> dict[str, Any]:
        summary = _churn_summary(0.7, db)
        records = _shap_records(db)
        return {
            "summary": summary,
            "last_refresh": {"last_refreshed_at": summary["refreshed_at"]},
            "probability_distribution": _probability_distribution(db),
            "reason_codes": _reason_codes_summary(db),
            "top_features": _top_features(records, 10),
            "feature_importance": _global_feature_importance(records, 15),
        }

    return _db(repo.cached_churn_overview, load_overview)


@router.get("/churn/top-features")
def churn_top_features(
    db: Session = Depends(get_db),
    limit: int = Query(10, ge=1, le=100),
    _: dict = Depends(require_any_page_access("analytics", "model")),
) -> dict[str, Any]:
    return _top_features(_shap_records(db), limit)


@router.get("/churn/feature-importance-global")
def global_feature_importance(
    db: Session = Depends(get_db),
    limit: int = Query(100, ge=1, le=500),
    _: dict = Depends(require_any_page_access("analytics", "model")),
) -> dict[str, Any]:
    return _global_feature_importance(_shap_records(db), limit)


@router.get("/members/{customer_unique_id}/risk")
def member_risk(
    customer_unique_id: str,
    db: Session = Depends(get_db),
    _: dict = Depends(require_page("customers")),
) -> dict[str, Any]:
    result = _db(repo.risk_for_customer, customer_unique_id, db)
    if result is None:
        raise HTTPException(
            status_code=404,
            detail=f"No risk record found for customer: {customer_unique_id}",
        )
    return result


@router.get("/data/last-refresh")
def data_last_refresh(
    db: Session = Depends(get_db),
    _: dict = Depends(require_any_page_access("analytics", "model")),
) -> dict[str, Any]:
    result = _db(repo.last_refresh, db) or {}
    return {"last_refreshed_at": result.get("last_refreshed_at")}


@router.get("/churn/probability-distribution")
def probability_distribution(
    db: Session = Depends(get_db),
    _: dict = Depends(require_any_page_access("analytics", "model")),
) -> dict[str, Any]:
    return _probability_distribution(db)


@router.get("/churn/reason-codes/summary")
def reason_codes_summary(
    db: Session = Depends(get_db),
    _: dict = Depends(require_any_page_access("analytics", "model")),
) -> dict[str, Any]:
    return _reason_codes_summary(db)


@router.get("/customers/{customer_unique_id}/explanation")
def customer_explanation(
    customer_unique_id: str,
    db: Session = Depends(get_db),
    _: dict = Depends(require_page("customers")),
) -> dict[str, Any]:
    row = _db(repo.prediction_for_customer, customer_unique_id, db)
    if row is None:
        raise HTTPException(
            status_code=404,
            detail=f"No stored prediction found for customer: {customer_unique_id}",
        )
    codes = _decode_json(row.get("reason_codes"), list)
    return {
        "customer_unique_id": row["customer_unique_id"],
        "churn_probability": float(row["churn_probability"]),
        "shap_values": _decode_json(row.get("shap_values"), dict),
        "reason_codes": [
            {"code": code, "message": REASON_CODE_MESSAGES.get(code, "")}
            for code in codes
        ],
        "model_version": row.get("model_version"),
        "scored_at": row.get("scored_at"),
    }
