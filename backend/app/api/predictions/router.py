import os
import json
import logging
import sys
from datetime import datetime, timezone
from pathlib import Path
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import text
import pandas as pd
import numpy as np

from app.api.churn_analytics.repository import clear_prediction_values_cache
from app.core.artifact_paths import get_customer_intelligence_root, get_models_dir
from app.core.auth import admin_auth, auth
from app.core.database import ANALYTICS_DB_NAME, get_db

router = APIRouter(prefix="/api/predictions", tags=["AI Predictions"])
logger = logging.getLogger("customer_sphere")

_cached_predictor = None


def get_ml_predictor():
    """Load the shared ML inference service once."""
    global _cached_predictor
    if _cached_predictor is not None:
        return _cached_predictor

    ml_project_root = get_customer_intelligence_root()
    if not ml_project_root.is_dir():
        raise RuntimeError(
            f"Customer Intelligence project was not found at {ml_project_root}. "
            "Set CUSTOMER_INTELLIGENCE_ROOT to its location."
        )

    project_root = str(ml_project_root)
    if project_root not in sys.path:
        sys.path.insert(0, project_root)

    try:
        # The backend itself is also an ``app`` package. Extend that package's
        # search path so the shared ML modules can be imported without loading
        # a second, conflicting ``app`` package.
        import app as backend_app

        ml_app_path = str(ml_project_root / "app")
        if ml_app_path not in backend_app.__path__:
            backend_app.__path__.append(ml_app_path)

        # This backend also contains app.ml for local helpers, so importing
        # app.ml first would otherwise hide the inference package in the
        # shared ML project.
        import app.ml as backend_ml

        source_ml_path = str(ml_project_root / "app" / "ml")
        if source_ml_path not in backend_ml.__path__:
            backend_ml.__path__.append(source_ml_path)

        from app.ml.explainibility_inference.inference.predict import ChurnPredictor

        model_path = Path(
            os.getenv(
                "MODEL_PATH",
                str(get_models_dir() / "lgb_churn_model_calibrated.joblib"),
            )
        ).expanduser()
        if not model_path.is_absolute():
            model_path = ml_project_root / model_path

        model_version = os.getenv("MODEL_VERSION", "v1")
        _cached_predictor = ChurnPredictor(
            model_path=model_path,
            model_version=model_version,
        )
        logger.info("Loaded ML inference service from %s", model_path)
    except Exception as exc:
        logger.exception("Unable to initialize the ML inference service")
        raise RuntimeError(
            "The AI model could not be initialized. Check the ML project path, "
            "model artifact, and Python dependencies."
        ) from exc

    return _cached_predictor

REASON_CODE_MESSAGES = {
    "RC01": "Customer leaves positive reviews, which lowers churn risk.",
    "RC01B": "Customer leaves negative or lukewarm reviews, which increases churn risk.",
    "RC02": "Customer has left at least one bad review, which increases churn risk.",
    "RC02B": "Customer has no bad reviews on record, which lowers churn risk.",
    "RC03": "Shipping cost makes up a large share of order value, increasing churn risk.",
    "RC03B": "Shipping cost makes up a small share of order value, lowering churn risk.",
    "RC04": "Orders tend to arrive slowly, increasing churn risk.",
    "RC04B": "Orders tend to arrive quickly, lowering churn risk.",
    "RC05": "Orders tend to arrive later than promised, increasing churn risk.",
    "RC05B": "Orders tend to arrive earlier than promised, lowering churn risk.",
    "RC06": "Recent order was delivered late, increasing churn risk.",
    "RC06B": "Recent order was delivered on time, lowering churn risk.",
}


def _build_realtime_feature_row(
    customer_unique_id: str,
    order_stats,
    payment_stats,
    review_stats,
    delivery_stats,
    frequency_stats,
) -> dict:
    total_spend = float(order_stats["total_spend"])
    total_freight = float(order_stats["total_freight"])
    total_value = total_spend + total_freight

    return {
        "customer_unique_id": customer_unique_id,
        "monetary_value": float(np.log1p(total_value)) if total_value > 0 else 0.0,
        "avg_payment_installments": float(payment_stats["avg_installments"]),
        "avg_review_score": float(review_stats["avg_review_score"]),
        "has_bad_review": int(review_stats["has_bad_review"]),
        "has_review_comment": int(review_stats["has_review_comment"]),
        "avg_product_weight_g": float(order_stats["avg_product_weight"]),
        "freight_ratio": total_freight / total_value if total_value > 0 else 0.15,
        "avg_delivery_days": float(delivery_stats["avg_delivery_days"]),
        "avg_delivery_delay_days": float(delivery_stats["avg_delivery_delay_days"]),
        "is_delayed_delivery": int(delivery_stats["is_delayed"]),
        "dominant_product_category_frequency": float(
            frequency_stats["category_frequency"]
        ),
        "customer_city_state_frequency": float(
            frequency_stats["city_state_frequency"]
        ),
        "preferred_payment_type_debit_card": int(payment_stats["used_debit_card"]),
    }


def _build_shap_drivers(
    shap_values: dict,
    feature_values: dict | None = None,
) -> list[dict]:
    feature_values = feature_values or {}
    return [
        {
            "feature": feature,
            "label": feature.replace("_", " ").title(),
            "impact": round(float(impact), 4),
            "direction": "increases_risk" if float(impact) > 0 else "lowers_risk",
            "feature_value": feature_values.get(feature),
        }
        for feature, impact in sorted(
            shap_values.items(),
            key=lambda item: abs(float(item[1])),
            reverse=True,
        )
    ]


def _compute_realtime_prediction(db: Session, customer_unique_id: str):
    """
    On-demand feature extraction and live model inference for newly added customers
    who haven't been scored in the offline batch yet.
    """
    customer = db.execute(
        text(f"""
            SELECT customer_id, customer_city, customer_state
            FROM customers
            WHERE customer_unique_id = :cuid
            LIMIT 1
        """),
        {"cuid": customer_unique_id},
    ).mappings().first()

    order_stats = None
    payment_stats = review_stats = delivery_stats = frequency_stats = None
    if customer:
        order_stats = db.execute(
            text("""
                SELECT
                    COUNT(DISTINCT o.order_id) AS total_orders,
                    COALESCE(SUM(oi.price), 0) AS total_spend,
                    COALESCE(SUM(oi.freight_value), 0) AS total_freight,
                    COALESCE(AVG(p.product_weight_g), 1200) AS avg_product_weight
                FROM orders o
                LEFT JOIN order_items oi ON oi.order_id = o.order_id
                LEFT JOIN products p ON p.product_id = oi.product_id
                WHERE o.customer_id IN (
                    SELECT c.customer_id
                    FROM customers c
                    WHERE c.customer_unique_id = :customer_unique_id
                )
            """),
            {"customer_unique_id": customer_unique_id},
        ).mappings().one()

        if order_stats["total_orders"] > 0:
            payment_stats = db.execute(
                text("""
                    SELECT
                        COALESCE(AVG(per_order.avg_installments), 1.0) AS avg_installments
                    FROM (
                        SELECT
                            o.order_id,
                            AVG(op.payment_installments) AS avg_installments
                        FROM orders o
                        LEFT JOIN order_payments op ON op.order_id = o.order_id
                        WHERE o.customer_id IN (
                            SELECT c.customer_id
                            FROM customers c
                            WHERE c.customer_unique_id = :customer_unique_id
                        )
                        GROUP BY o.order_id
                    ) AS per_order
                """),
                {"customer_unique_id": customer_unique_id},
            ).mappings().one()
            preferred_payment = db.execute(
                text("""
                    SELECT op.payment_type
                    FROM orders o
                    JOIN order_payments op ON op.order_id = o.order_id
                    WHERE o.customer_id IN (
                        SELECT c.customer_id
                        FROM customers c
                        WHERE c.customer_unique_id = :customer_unique_id
                    )
                      AND op.payment_type IS NOT NULL
                    GROUP BY op.payment_type
                    ORDER BY COUNT(DISTINCT o.order_id) DESC, op.payment_type ASC
                    LIMIT 1
                """),
                {"customer_unique_id": customer_unique_id},
            ).mappings().first()
            payment_stats = {
                **payment_stats,
                "used_debit_card": int(
                    preferred_payment is not None
                    and preferred_payment["payment_type"] == "debit_card"
                ),
            }

            review_stats = db.execute(
                text("""
                    SELECT
                        COALESCE(AVG(r.review_score), 4.2) AS avg_review_score,
                        COALESCE(MAX(CASE
                            WHEN r.review_comment_message IS NOT NULL
                                 AND TRIM(r.review_comment_message) != ''
                            THEN 1 ELSE 0
                        END), 0) AS has_review_comment
                    FROM orders o
                    LEFT JOIN order_reviews r ON r.order_id = o.order_id
                    WHERE o.customer_id IN (
                        SELECT c.customer_id
                        FROM customers c
                        WHERE c.customer_unique_id = :customer_unique_id
                    )
                """),
                {"customer_unique_id": customer_unique_id},
            ).mappings().one()
            has_bad_review = db.execute(
                text("""
                    SELECT EXISTS(
                        SELECT 1
                        FROM orders o
                        JOIN order_reviews r ON r.order_id = o.order_id
                        WHERE o.customer_id IN (
                            SELECT c.customer_id
                            FROM customers c
                            WHERE c.customer_unique_id = :customer_unique_id
                        )
                          AND CAST(r.review_score AS DECIMAL(3, 1)) <= 2
                    ) AS has_bad_review
                """),
                {"customer_unique_id": customer_unique_id},
            ).scalar()
            review_stats = {
                **review_stats,
                "has_bad_review": int(has_bad_review or 0),
            }

            delivery_stats = db.execute(
                text("""
                    SELECT
                        COALESCE(AVG(DATEDIFF(
                            o.order_delivered_customer_date,
                            o.order_purchase_timestamp
                        )), 9.0) AS avg_delivery_days,
                        COALESCE(AVG(DATEDIFF(
                            o.order_delivered_customer_date,
                            o.order_estimated_delivery_date
                        )), -6.0) AS avg_delivery_delay_days,
                        COALESCE(MAX(CASE
                            WHEN o.order_delivered_customer_date >
                                 o.order_estimated_delivery_date
                            THEN 1 ELSE 0
                        END), 0) AS is_delayed
                    FROM orders o
                    WHERE o.customer_id IN (
                        SELECT c.customer_id
                        FROM customers c
                        WHERE c.customer_unique_id = :customer_unique_id
                    )
                      AND o.order_status = 'delivered'
                      AND o.order_delivered_customer_date IS NOT NULL
                """),
                {"customer_unique_id": customer_unique_id},
            ).mappings().one()

            category_row = db.execute(
                text("""
                    SELECT p.product_category_name
                    FROM orders o
                    JOIN order_items oi ON oi.order_id = o.order_id
                    JOIN products p ON p.product_id = oi.product_id
                    WHERE o.customer_id IN (
                        SELECT c.customer_id
                        FROM customers c
                        WHERE c.customer_unique_id = :customer_unique_id
                    )
                      AND p.product_category_name IS NOT NULL
                    GROUP BY p.product_category_name
                    ORDER BY COUNT(oi.order_item_id) DESC,
                             p.product_category_name ASC
                    LIMIT 1
                """),
                {"customer_unique_id": customer_unique_id},
            ).mappings().first()
            dominant_category = (
                category_row["product_category_name"] if category_row else "unknown"
            )
            city_state = (
                f"{(customer['customer_city'] or '').strip()}, "
                f"{(customer['customer_state'] or '').strip()}"
            ).strip().strip(",") or "unknown"

            frequency_stats = db.execute(
                text(f"""
                    WITH customer_category_counts AS (
                        SELECT
                            c.customer_unique_id,
                            p.product_category_name AS dominant_product_category,
                            COUNT(*) AS category_count
                        FROM customers c
                        JOIN orders o ON o.customer_id = c.customer_id
                        JOIN order_items oi ON oi.order_id = o.order_id
                        JOIN products p ON p.product_id = oi.product_id
                        WHERE p.product_category_name IS NOT NULL
                        GROUP BY c.customer_unique_id, p.product_category_name
                    ),
                    ranked_customer_categories AS (
                        SELECT
                            customer_unique_id,
                            dominant_product_category,
                            ROW_NUMBER() OVER (
                                PARTITION BY customer_unique_id
                                ORDER BY category_count DESC, dominant_product_category ASC
                            ) AS category_rank
                        FROM customer_category_counts
                    ),
                    current_features AS (
                        SELECT
                            c.customer_unique_id,
                            CONCAT(
                                COALESCE(c.customer_city, ''),
                                ', ',
                                COALESCE(c.customer_state, '')
                            ) AS customer_city_state,
                            COALESCE(rc.dominant_product_category, 'unknown')
                                AS dominant_product_category
                        FROM customers c
                        LEFT JOIN ranked_customer_categories rc
                            ON rc.customer_unique_id = c.customer_unique_id
                           AND rc.category_rank = 1
                    )
                    SELECT
                        COALESCE(AVG(customer_city_state = :city_state), 0)
                            AS city_state_frequency,
                        COALESCE(AVG(
                            BINARY dominant_product_category = BINARY :category
                        ), 0) AS category_frequency
                    FROM current_features
                """),
                {"city_state": city_state, "category": dominant_category},
            ).mappings().one()

    has_orders = order_stats and order_stats["total_orders"] > 0
    total_spend = float(order_stats["total_spend"]) if order_stats else 0.0

    churn_prob = 0.25  # baseline for brand new user with 0 orders
    risk_level = "low"
    shap_drivers = []
    reason_codes_list = []

    if has_orders:
        try:
            feature_values = _build_realtime_feature_row(
                customer_unique_id,
                order_stats,
                payment_stats,
                review_stats,
                delivery_stats,
                frequency_stats,
            )
            features_df = pd.DataFrame([feature_values])

            prediction = get_ml_predictor().predict(features_df)[0]
            churn_prob = float(prediction["churn_probability"])
            reason_codes_list = [
                {
                    "code": code,
                    "explanation": REASON_CODE_MESSAGES.get(
                        code, "Significant behavioral indicator observed."
                    ),
                }
                for code in prediction["reason_codes"]
            ]
            shap_drivers = _build_shap_drivers(
                prediction["shap_values"],
                feature_values,
            )
            risk_level = (
                "high"
                if churn_prob >= 0.70
                else "medium"
                if churn_prob >= 0.30
                else "low"
            )

        except Exception as e:
            logger.exception("Error in on-the-fly scoring")
            raise RuntimeError(
                "The AI model could not score this customer. Check the ML "
                "inference dependencies and model artifact."
            ) from e
    elif not has_orders:
        reason_codes_list.append({
            "code": "RC_NEW",
            "explanation": "Newly registered customer. Zero order attrition risk currently observed.",
        })

    # ── Fetch real ML-pipeline CLV from customer_intelligence DB ──
    clv_row = db.execute(
        text(f"""
            SELECT clv, value_tier, purchase_frequency_per_year, customer_lifespan_years
            FROM {ANALYTICS_DB_NAME}.customer_clv
            WHERE customer_unique_id = :cuid
            LIMIT 1
        """),
        {"cuid": customer_unique_id},
    ).mappings().first()

    if clv_row and clv_row["clv"] is not None:
        clv_val = round(float(clv_row["clv"]), 2)
        value_tier = clv_row["value_tier"] or ("High" if clv_val > 500 else ("Medium" if clv_val > 200 else "Low"))
        purchase_freq = round(float(clv_row["purchase_frequency_per_year"]), 2) if clv_row["purchase_frequency_per_year"] else 1.0
        lifespan_yrs = round(float(clv_row["customer_lifespan_years"]), 2) if clv_row["customer_lifespan_years"] else 1.0
    else:
        # Formula fallback only for genuinely new customers not in ML pipeline
        clv_val = round(total_spend * 1.25, 2) if total_spend > 0 else 0.0
        value_tier = "High" if clv_val > 500 else ("Medium" if clv_val > 200 else "Low")
        purchase_freq = 1.0
        lifespan_yrs = 1.0

    # The manual run must reflect the fresh model result. The offline
    # customer_risk_tiers table is refreshed separately and may contain a
    # stale value from before the customer's latest orders or reviews.
    segment_label = f"{risk_level.title()} Risk"
    segment_risk_tier = segment_label
    cluster_prob = 0.95

    # ── Fetch campaign recommendation from customer_intelligence DB ──
    campaign_row = db.execute(
        text(f"""
            SELECT campaign_name, campaign_priority, reason_code
            FROM {ANALYTICS_DB_NAME}.customer_campaign_recommendations
            WHERE customer_unique_id = :cuid
            LIMIT 1
        """),
        {"cuid": customer_unique_id},
    ).mappings().first()

    if campaign_row and campaign_row["campaign_name"]:
        campaign_name = campaign_row["campaign_name"]
        campaign_priority = campaign_row["campaign_priority"]
        campaign_reason = campaign_row["reason_code"]
    else:
        campaign_name = "Welcome & First-Purchase Onboarding" if not has_orders else "Repeat Purchase Incentive Program"
        campaign_priority = 1 if not has_orders else 2
        campaign_reason = "RC_NEW" if not has_orders else "RC04"

    return {
        "customer_unique_id": customer_unique_id,
        "has_ml_data": True,
        "is_realtime_score": True,
        "churn": {
            "probability": round(churn_prob, 4),
            "percentage": round(churn_prob * 100, 1),
            "risk_level": risk_level,
            "model_version": os.getenv("MODEL_VERSION", "v1"),
            "scored_at": datetime.now(timezone.utc).isoformat(),
        },
        "explainability": {
            "reason_codes": reason_codes_list,
            "shap_drivers": shap_drivers,
        },
        "feature_values": (
            {
                key: value
                for key, value in feature_values.items()
                if key != "customer_unique_id"
            }
            if has_orders
            else None
        ),
        "clv": {
            "predicted_clv": clv_val,
            "value_tier": value_tier,
            "purchase_frequency_per_year": purchase_freq,
            "customer_lifespan_years": lifespan_yrs,
        },
        "segmentation": {
            "segment_label": segment_label,
            "risk_tier": segment_risk_tier,
            "cluster_probability": cluster_prob,
        },
        "recommendation": {
            "campaign_name": campaign_name,
            "priority": campaign_priority,
            "trigger_reason": campaign_reason,
        },
    }


@router.get("/{customer_id_or_unique_id}")
def get_customer_predictions(
    customer_id_or_unique_id: str,
    db: Session = Depends(get_db),
    _=Depends(auth),
):
    """
    Fetch comprehensive AI intelligence for a customer by customer_id or customer_unique_id.
    If no precomputed offline row is found, automatically scores the customer on-the-fly.
    """
    # 1. Resolve customer_unique_id
    customer_unique_id = customer_id_or_unique_id
    if len(customer_id_or_unique_id) == 32:
        cust_row = db.execute(
            text("SELECT customer_unique_id FROM customers WHERE customer_id = :cid LIMIT 1"),
            {"cid": customer_id_or_unique_id},
        ).mappings().first()
        if cust_row:
            customer_unique_id = cust_row["customer_unique_id"]

    # 2. Query precomputed ML intelligence tables
    query = text(f"""
        SELECT 
            cp.churn_probability,
            cp.shap_values,
            cp.reason_codes,
            cp.model_version,
            cp.scored_at,
            clv.clv,
            clv.value_tier,
            clv.purchase_frequency_per_year,
            clv.customer_lifespan_years,
            cs.cluster_probability,
            cr.campaign_name,
            cr.campaign_priority,
            cr.reason_code AS campaign_reason_code
        FROM {ANALYTICS_DB_NAME}.churn_predictions cp
        LEFT JOIN {ANALYTICS_DB_NAME}.customer_clv clv
            ON clv.customer_unique_id COLLATE utf8mb4_unicode_ci = cp.customer_unique_id COLLATE utf8mb4_unicode_ci
        LEFT JOIN {ANALYTICS_DB_NAME}.customer_segments cs
            ON cs.customer_unique_id COLLATE utf8mb4_unicode_ci = cp.customer_unique_id COLLATE utf8mb4_unicode_ci
        LEFT JOIN {ANALYTICS_DB_NAME}.customer_campaign_recommendations cr
            ON cr.customer_unique_id COLLATE utf8mb4_unicode_ci = cp.customer_unique_id COLLATE utf8mb4_unicode_ci
        WHERE cp.customer_unique_id = :cuid
        ORDER BY cp.scored_at DESC
        LIMIT 1
    """)

    row = db.execute(query, {"cuid": customer_unique_id}).mappings().first()

    if not row:
        # Fallback: Compute real-time on-the-fly scoring for new customer!
        return _compute_realtime_prediction(db, customer_unique_id)

    # 3. Parse SHAP values & format top positive/negative drivers
    shap_dict = {}
    if row["shap_values"]:
        try:
            raw_shap = json.loads(row["shap_values"])
            shap_dict = {k: round(float(v), 4) for k, v in raw_shap.items()}
        except Exception:
            shap_dict = {}

    shap_drivers = _build_shap_drivers(shap_dict)

    # 4. Parse Reason codes
    reason_codes_list = []
    if row["reason_codes"]:
        try:
            codes = json.loads(row["reason_codes"])
            if isinstance(codes, list):
                reason_codes_list = [
                    {
                        "code": c,
                        "explanation": REASON_CODE_MESSAGES.get(c, "Significant behavioral indicator observed."),
                    }
                    for c in codes
                ]
        except Exception:
            reason_codes_list = []

    churn_prob = float(row["churn_probability"]) if row["churn_probability"] is not None else 0.0
    risk_level = "high" if churn_prob >= 0.70 else "medium" if churn_prob >= 0.30 else "low"

    return {
        "customer_unique_id": customer_unique_id,
        "has_ml_data": True,
        "is_realtime_score": False,
        "churn": {
            "probability": round(churn_prob, 4),
            "percentage": round(churn_prob * 100, 1),
            "risk_level": risk_level,
            "model_version": row["model_version"] or "LightGBM Calibrated v1",
            "scored_at": row["scored_at"],
        },
        "explainability": {
            "reason_codes": reason_codes_list,
            "shap_drivers": shap_drivers,
        },
        "feature_values": None,
        "clv": {
            "predicted_clv": round(float(row["clv"]), 2) if row["clv"] is not None else None,
            "value_tier": row["value_tier"],
            "purchase_frequency_per_year": round(float(row["purchase_frequency_per_year"]), 2) if row["purchase_frequency_per_year"] is not None else None,
            "customer_lifespan_years": round(float(row["customer_lifespan_years"]), 2) if row["customer_lifespan_years"] is not None else None,
        },
        "segmentation": {
            "segment_label": f"{risk_level.title()} Risk",
            "risk_tier": f"{risk_level.title()} Risk",
            "cluster_probability": round(float(row["cluster_probability"]), 4) if row["cluster_probability"] is not None else None,
        },
        "recommendation": {
            "campaign_name": row["campaign_name"],
            "priority": row["campaign_priority"],
            "trigger_reason": row["campaign_reason_code"],
        },
    }


@router.post("/{customer_id_or_unique_id}/rescore")
def rescore_customer_manually(
    customer_id_or_unique_id: str,
    db: Session = Depends(get_db),
    _=Depends(admin_auth),
):
    """
    Manually force re-runs the ML prediction model for a customer and returns the fresh score.
    UI Trigger: 'Run AI Model' button.
    """
    customer_unique_id = customer_id_or_unique_id
    if len(customer_id_or_unique_id) == 32:
        cust_row = db.execute(
            text("SELECT customer_unique_id FROM customers WHERE customer_id = :cid LIMIT 1"),
            {"cid": customer_id_or_unique_id},
        ).mappings().first()
        if cust_row:
            customer_unique_id = cust_row["customer_unique_id"]

    # Compute fresh dynamic score
    fresh_predictions = _compute_realtime_prediction(db, customer_unique_id)

    churn = fresh_predictions["churn"]
    explainability = fresh_predictions["explainability"]
    prediction_values = {
        "customer_unique_id": customer_unique_id,
        "churn_probability": churn["probability"],
        "shap_values": json.dumps(
            {driver["feature"]: driver["impact"]
             for driver in explainability["shap_drivers"]}
        ),
        "reason_codes": json.dumps(
            [item["code"] for item in explainability["reason_codes"]]
        ),
        "model_version": churn["model_version"],
        "scored_at": churn["scored_at"],
    }
    updated_prediction = db.execute(
        text(
            f"""UPDATE {ANALYTICS_DB_NAME}.churn_predictions
               SET churn_probability = :churn_probability,
                   shap_values = :shap_values,
                   reason_codes = :reason_codes,
                   model_version = :model_version,
                   scored_at = :scored_at
               WHERE customer_unique_id = :customer_unique_id"""
        ),
        prediction_values,
    )
    if updated_prediction.rowcount == 0:
        db.execute(
            text(
                f"""INSERT INTO {ANALYTICS_DB_NAME}.churn_predictions
                       (customer_unique_id, churn_probability, shap_values,
                        reason_codes, model_version, scored_at)
                   VALUES (:customer_unique_id, :churn_probability, :shap_values,
                           :reason_codes, :model_version, :scored_at)"""
            ),
            prediction_values,
        )

    # Keep the customer directory in sync with the result shown by the AI
    # insights page. The directory falls back to customer_metrics_cache when
    # the offline customer_risk_tiers pipeline has not produced a row yet.
    segment = fresh_predictions["segmentation"]["segment_label"]
    db.execute(
        text(
            """UPDATE customer_metrics_cache
               SET segment = :segment
               WHERE customer_unique_id = :customer_unique_id"""
        ),
        {"segment": segment, "customer_unique_id": customer_unique_id},
    )
    cache_row = db.execute(
        text(
            """SELECT 1
               FROM customer_metrics_cache
               WHERE customer_unique_id = :customer_unique_id
               LIMIT 1"""
        ),
        {"customer_unique_id": customer_unique_id},
    ).first()
    if cache_row is None:
        db.rollback()
        raise RuntimeError(
            f"Could not update the segment cache for customer {customer_unique_id!r}"
        )
    db.commit()
    clear_prediction_values_cache()
    return fresh_predictions
