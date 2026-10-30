
from typing import Optional

import numpy as np
import pandas as pd
from dotenv import load_dotenv
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import text

from app.core.database import ANALYTICS_DB_NAME, engine
from app.core.permissions import require_any_page_access, require_page

load_dotenv()

CONFIG = {
    "analytics_schema": ANALYTICS_DB_NAME,
    # CLV table (generate_clv_table.py output)
    "clv_table": f"{ANALYTICS_DB_NAME}.customer_clv",
    "clv_customer_id": "customer_unique_id",
    "clv_value": "clv",                # numeric CLV column
    "clv_tier": "value_tier",          # e.g. Low / Medium / High
    # churn predictions table
    "churn_table": f"{ANALYTICS_DB_NAME}.churn_predictions",
    "churn_customer_id": "customer_unique_id",
    "churn_prob": "churn_probability",
    # NOTE: risk_tier lives in customer_segments (not churn_predictions)
    "risk_tier": "risk_tier",
    "high_risk_label": "High",         # matched with LIKE 'High%', so 'High' and 'High Risk' both work
    # segments table
    "seg_table": f"{ANALYTICS_DB_NAME}.customer_segments",
    "seg_customer_id": "customer_unique_id",
    "seg_label": "segment_label",
    # orders / payments / products (Olist-style)
    "orders_table": "orders",
    # orders.customer_id is per-order; the real customer is customers.customer_unique_id
    "customers_table": "customers",
    "cust_order_key": "customer_id",
    "cust_unique_id": "customer_unique_id",
    "orders_customer_id": "customer_id",
    # Which key do customer_clv / churn_predictions / customer_segments use?
    # "unique" -> customer_unique_id, "order" -> customers.customer_id
    "pipeline_key": "unique",
    "orders_order_id": "order_id",
    "orders_status": "order_status",
    "orders_delivered": "order_delivered_customer_date",
    "orders_estimated": "order_estimated_delivery_date",
    "orders_purchased": "order_purchase_timestamp",
    "payments_table": "order_payments",
    "pay_order_id": "order_id",
    "pay_installments": "payment_installments",
    "pay_value": "payment_value",
    "items_table": "order_items",
    "items_order_id": "order_id",
    "items_product_id": "product_id",
    "products_table": "products",
    "products_product_id": "product_id",
    "products_category": "product_category_name",
}
C = CONFIG

# Column (on the customers table aliased `cu`) that matches the pipeline tables' customer key
CU_KEY = f"cu.{C['cust_unique_id'] if C['pipeline_key'] == 'unique' else C['cust_order_key']}"

HR = f"{C['high_risk_label']}%"  # LIKE pattern for the high-risk tier

# --------------------------------------------------------------------------
# DB helpers
# --------------------------------------------------------------------------
def get_engine():
    """Return the backend's shared SQLAlchemy engine."""
    return engine


def q(sql: str, params: Optional[dict] = None) -> pd.DataFrame:
    try:
        with get_engine().connect() as conn:
            return pd.read_sql(text(sql), conn, params=params or {})
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Query failed: {e}")


def records(df: pd.DataFrame) -> list:
    df = df.replace({np.nan: None})
    return df.to_dict(orient="records")


router = APIRouter(tags=["CLV, Delivery & Payments"])

# --------------------------------------------------------------------------
# CLV
# --------------------------------------------------------------------------


@router.get("/clv/summary")
def clv_summary(_: dict = Depends(require_page("analytics"))):
    df = q(f"""
        SELECT COUNT(*) AS customers,
               SUM({C['clv_value']}) AS total_clv,
               AVG({C['clv_value']}) AS avg_clv,
               MAX({C['clv_value']}) AS max_clv,
               MIN({C['clv_value']}) AS min_clv
        FROM {C['clv_table']}
    """)
    vals = q(f"SELECT {C['clv_value']} AS v FROM {C['clv_table']}")["v"].dropna()
    out = records(df)[0]
    out["median_clv"] = float(vals.median()) if len(vals) else None
    return out


@router.get("/customers/byvaluetier")
def customers_by_value_tier(_: dict = Depends(require_page("analytics"))):
    df = q(f"""
        SELECT {C['clv_tier']} AS value_tier,
               COUNT(*) AS customers,
               AVG({C['clv_value']}) AS avg_clv,
               SUM({C['clv_value']}) AS total_clv
        FROM {C['clv_table']}
        GROUP BY {C['clv_tier']}
        ORDER BY total_clv DESC
    """)
    total = df["customers"].sum()
    df["pct_share"] = (df["customers"] / total * 100).round(2) if total else 0
    return records(df)


@router.get("/customers/{customer_id}/clv")
def customer_clv(customer_id: str, _: dict = Depends(require_page("customers"))):
    df = q(f"""
        SELECT c.*, s.{C['seg_label']} AS segment_label,
               p.{C['churn_prob']} AS churn_probability,
               s.{C['risk_tier']} AS risk_tier
        FROM {C['clv_table']} c
        LEFT JOIN {C['seg_table']} s ON s.{C['seg_customer_id']} = c.{C['clv_customer_id']}
        LEFT JOIN {C['churn_table']} p ON p.{C['churn_customer_id']} = c.{C['clv_customer_id']}
        WHERE c.{C['clv_customer_id']} = :cid
        LIMIT 1
    """, {"cid": customer_id})
    if df.empty:
        raise HTTPException(status_code=404, detail="Customer not found")
    return records(df)[0]


# --------------------------------------------------------------------------
# Delivery and payment drivers
# --------------------------------------------------------------------------


@router.get("/delivery/performance")
def delivery_performance(_: dict = Depends(require_page("analytics"))):
    """Overall delivery KPIs plus churn probability for on-time vs late customers."""
    by_status = q(f"""
        SELECT
               CASE WHEN o.{C['orders_delivered']} > o.{C['orders_estimated']}
                    THEN 'Late' ELSE 'On time' END AS delivery_status,
               COUNT(*) AS orders,
               AVG(DATEDIFF(o.{C['orders_delivered']}, o.{C['orders_purchased']}))
                   AS avg_delivery_days,
               AVG(p.{C['churn_prob']}) AS avg_churn_probability
        FROM {C['orders_table']} o
        JOIN {C['customers_table']} cu
          ON cu.{C['cust_order_key']} = o.{C['orders_customer_id']}
        LEFT JOIN {C['churn_table']} p
          ON p.{C['churn_customer_id']} = {CU_KEY}
        WHERE o.{C['orders_status']} = 'delivered'
          AND o.{C['orders_delivered']} IS NOT NULL
        GROUP BY delivery_status
    """)

    by_delivery_status = records(by_status)
    delivered_orders = sum(int(row["orders"]) for row in by_delivery_status)
    total_delivery_days = sum(
        float(row["avg_delivery_days"] or 0) * int(row["orders"])
        for row in by_delivery_status
    )
    on_time_orders = sum(
        int(row["orders"])
        for row in by_delivery_status
        if row["delivery_status"] == "On time"
    )
    late_orders = sum(
        int(row["orders"])
        for row in by_delivery_status
        if row["delivery_status"] == "Late"
    )
    summary = {
        "delivered_orders": delivered_orders,
        "avg_delivery_days": (
            round(total_delivery_days / delivered_orders, 4)
            if delivered_orders
            else None
        ),
        "on_time_pct": (
            100 * on_time_orders / delivered_orders if delivered_orders else None
        ),
        "late_pct": 100 * late_orders / delivered_orders if delivered_orders else None,
    }
    return {"summary": summary, "by_delivery_status": by_delivery_status}


@router.get("/customers/{customer_id}/delivery")
def customer_delivery_performance(
    customer_id: str,
    _: dict = Depends(require_page("customers")),
):
    """Return delivery outcomes for one customer_unique_id."""
    df = q(f"""
        SELECT o.{C['orders_order_id']} AS order_id,
               o.{C['orders_purchased']} AS purchased_at,
               o.{C['orders_delivered']} AS delivered_at,
               o.{C['orders_estimated']} AS estimated_delivery_at,
               DATEDIFF(o.{C['orders_delivered']}, o.{C['orders_purchased']}) AS delivery_days,
               CASE WHEN o.{C['orders_delivered']} > o.{C['orders_estimated']}
                    THEN 'Late' ELSE 'On time' END AS delivery_status
        FROM {C['orders_table']} o
        JOIN {C['customers_table']} cu
          ON cu.{C['cust_order_key']} = o.{C['orders_customer_id']}
        WHERE {CU_KEY} = :customer_id
          AND o.{C['orders_status']} = 'delivered'
          AND o.{C['orders_delivered']} IS NOT NULL
        ORDER BY o.{C['orders_purchased']} DESC
    """, {"customer_id": customer_id})
    if df.empty:
        exists = q(
            f"SELECT 1 AS found FROM {C['customers_table']} "
            f"WHERE {C['cust_unique_id']} = :customer_id LIMIT 1",
            {"customer_id": customer_id},
        )
        if exists.empty:
            raise HTTPException(status_code=404, detail="Customer not found")
        return {
            "customer_unique_id": customer_id,
            "summary": {
                "delivered_orders": 0,
                "avg_delivery_days": None,
                "on_time_pct": None,
                "late_pct": None,
            },
            "deliveries": [],
        }

    total = len(df)
    late_count = int((df["delivery_status"] == "Late").sum())
    return {
        "customer_unique_id": customer_id,
        "summary": {
            "delivered_orders": total,
            "avg_delivery_days": float(df["delivery_days"].mean()),
            "on_time_pct": round((total - late_count) / total * 100, 2),
            "late_pct": round(late_count / total * 100, 2),
        },
        "deliveries": records(df.head(10)),
    }
