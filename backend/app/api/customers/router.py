import os
import io
import csv
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy import text
from app.core.auth import auth, admin_auth
from app.core.database import ANALYTICS_DB_NAME, get_db
from app.core.serialization import rows, ser
from app.models import AuditLog
from app.schemas import CustomerIn

router = APIRouter(tags=["customers"])

# Blueprints for Bulk Action Payloads
class BulkSegmentUpdateIn(BaseModel):
    customer_unique_ids: list[str]
    segment: str

class BulkDeleteIn(BaseModel):
    customer_unique_ids: list[str]


# ------------------------------------------------------------------------------
# 1. Customer Directory Listing with Search, Filters & Sorting
# ------------------------------------------------------------------------------
@router.get("/api/customers")
def customers(
    q: str = "",
    state: str = "",
    segment: str = "",
    activity: str = "",
    max_recency: int | None = None,
    min_spend: float | None = None,
    min_orders: int | None = None,
    min_rating: float | None = None,
    rating: str = "",
    ratings: list[str] | None = None,
    churn_risk: str = "",
    include_churn: bool = True,
    sort_by: str | None = None,
    sort_dir: str | None = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(12, ge=1),
    db: Session = Depends(get_db),
    _: str = Depends(auth),
):
    """
    Fetches paginated list of customers matching search queries and filter criteria.
    UI Component: `Customers.jsx` directory table and pagination bar.
    """
    f = ["1=1"]
    p = {"offset": (page - 1) * page_size, "limit": page_size}
    if q and str(q).strip():
        f.append(
            "(c.customer_unique_id LIKE :q OR c.customer_city LIKE :q OR c.customer_id LIKE :q)"
        )
        p["q"] = f"%{str(q).strip()}%"
    if state and str(state).strip():
        f.append("c.customer_state=:state")
        p["state"] = str(state).upper()
    if segment:
        f.append(
            "COALESCE(rt.risk_tier, m.segment) COLLATE utf8mb4_unicode_ci "
            "= :segment COLLATE utf8mb4_unicode_ci"
        )
        p["segment"] = segment
    if activity == "active":
        f.append("m.frequency>0")
    elif activity == "inactive":
        f.append("m.frequency=0")
    elif activity:
        raise HTTPException(400, "Invalid activity filter")
    if max_recency is not None:
        f.append("m.recency_days<=:max_recency")
        p["max_recency"] = max_recency
    if min_spend is not None:
        f.append("m.monetary_total>=:min_spend")
        p["min_spend"] = min_spend
    if min_orders is not None:
        f.append("m.frequency>=:min_orders")
        p["min_orders"] = min_orders

    # Star rating filter parsing
    selected_ratings = []
    if rating:
        for r_part in rating.split(","):
            r_part = r_part.strip()
            if r_part:
                try:
                    selected_ratings.append(int(float(r_part)))
                except ValueError:
                    if r_part == "unrated":
                        pass
    if ratings:
        for r_item in ratings:
            for r_part in str(r_item).split(","):
                r_part = r_part.strip()
                if r_part:
                    try:
                        selected_ratings.append(int(float(r_part)))
                    except ValueError:
                        pass
    selected_ratings = sorted(list(set(selected_ratings)))

    if selected_ratings:
        r_clauses = []
        for i, val in enumerate(selected_ratings):
            param_key = f"rating_{i}"
            r_clauses.append(f":{param_key}")
            p[param_key] = val
        f.append(f"ROUND(m.avg_review_score) IN ({','.join(r_clauses)})")
    elif min_rating is not None:
        f.append("m.avg_review_score>=:min_rating")
        p["min_rating"] = min_rating

    # Churn risk filter uses the model probability shown by the segment dot.
    include_churn_details = include_churn or bool(churn_risk) or sort_by == "churn_risk"
    churn_probability_filter_expr = "(cp.churn_probability * 100)"
    churn_probability_expr = "(MAX(cp.churn_probability) * 100)"
    if churn_risk:
        risk_levels = [r.strip().lower() for r in churn_risk.split(",") if r.strip()]
        risk_conds = []
        if "high" in risk_levels:
            risk_conds.append(f"{churn_probability_filter_expr} >= 70")
        if "medium" in risk_levels:
            risk_conds.append(f"({churn_probability_filter_expr} >= 30 AND {churn_probability_filter_expr} < 70)")
        if "low" in risk_levels:
            risk_conds.append(f"{churn_probability_filter_expr} < 30")
        if risk_conds:
            f.append(f"({' OR '.join(risk_conds)})")

    where = " AND ".join(f)
    risk_tiers_join = f"""LEFT JOIN {ANALYTICS_DB_NAME}.customer_risk_tiers rt
        ON rt.customer_unique_id COLLATE utf8mb4_unicode_ci =
           c.customer_unique_id COLLATE utf8mb4_unicode_ci"""
    churn_join = f"""LEFT JOIN {ANALYTICS_DB_NAME}.churn_predictions cp
        ON cp.customer_unique_id COLLATE utf8mb4_unicode_ci =
           c.customer_unique_id COLLATE utf8mb4_unicode_ci"""

    count_joins = f"JOIN customer_metrics_cache m ON m.customer_id = c.customer_id"
    if segment:
        count_joins += f" {risk_tiers_join}"
    if churn_risk:
        count_joins += f" {churn_join}"

    # Multi-field sorting
    sort_map = {
        "spend": "m.monetary_total",
        "rating": "m.avg_review_score",
        "recency": "m.recency_days",
        "orders": "m.frequency",
        "city": "MIN(c.customer_city)",
        "churn_risk": "churn_risk_score",
    }
    col = sort_map.get(sort_by) if sort_by in sort_map else "c.customer_unique_id"
    direction = "ASC" if str(sort_dir).lower() == "asc" else "DESC"
    order_clause = f"{col} {direction}"
    churn_columns = (
        f""",
                ROUND(MAX(cp.churn_probability) * 100, 2) AS churn_percentage,
                ROUND({churn_probability_expr}, 2) AS churn_risk_score,
                CASE
                    WHEN {churn_probability_expr} >= 70 THEN 'high'
                    WHEN {churn_probability_expr} >= 30 THEN 'medium'
                    ELSE 'low'
                END AS churn_risk_level"""
        if include_churn_details
        else ""
    )

    total = (
        db.execute(
            text(f"SELECT COUNT(DISTINCT c.customer_unique_id) FROM customers c {count_joins} WHERE {where}"), p
        ).scalar()
        or 0
    )
    rs = db.execute(
        text(
            f"""SELECT
                MIN(c.customer_id) as customer_id,
                c.customer_unique_id,
                MIN(c.customer_city) as customer_city,
                MIN(c.customer_state) as customer_state,
                m.recency_days,
                m.frequency,
                m.monetary_total,
                m.avg_review_score,
                CASE WHEN m.frequency>1 THEN 1 ELSE 0 END as is_repeat_customer,
                COALESCE(rt.risk_tier, m.segment) COLLATE utf8mb4_unicode_ci AS segment
                {churn_columns}
            FROM customers c 
            JOIN customer_metrics_cache m ON m.customer_id = c.customer_id
            {risk_tiers_join}
            {churn_join if include_churn_details else ""}
            WHERE {where} 
            GROUP BY c.customer_unique_id, m.recency_days, m.frequency, m.monetary_total, m.avg_review_score, rt.risk_tier, m.segment
            ORDER BY {order_clause} 
            LIMIT :limit OFFSET :offset"""
        ),
        p,
    ).fetchall()
    return {
        "items": rows(rs),
        "total": int(total),
        "page": page,
        "page_size": page_size,
        "pages": (int(total) + page_size - 1) // page_size,
    }


# ------------------------------------------------------------------------------
# 2. Add New Customer Profile (Admin Only)
# ------------------------------------------------------------------------------
@router.get("/api/customers/id-availability")
def customer_id_availability(
    customer_unique_id: str = Query(min_length=1, max_length=32),
    db: Session = Depends(get_db),
    _: str = Depends(admin_auth),
):
    existing = db.execute(
        text(
            "SELECT 1 FROM customers "
            "WHERE customer_unique_id = :unique_id LIMIT 1"
        ),
        {"unique_id": customer_unique_id.strip()},
    ).fetchone()
    return {"available": existing is None}


@router.post("/api/customers")
def add_customer(
    x: CustomerIn, db: Session = Depends(get_db), u: dict = Depends(admin_auth)
):
    """
    Creates a new customer profile and initializes cache metrics.
    UI Component: 'Add Customer' modal in `CustomerModal.jsx`.
    """
    existing = db.execute(
        text("SELECT customer_unique_id FROM customers WHERE customer_unique_id = :unique_id LIMIT 1"),
        {"unique_id": x.customer_unique_id.strip()},
    ).fetchone()
    if existing:
        raise HTTPException(
            status_code=400,
            detail="Customer already exists",
        )

    customer_id = os.urandom(16).hex()
    db.execute(
        text(
            "INSERT INTO customers (customer_id,customer_unique_id,customer_zip_code_prefix,customer_city,customer_state) VALUES (:id,:unique_id,:zip,:city,:state)"
        ),
        {
            "id": customer_id,
            "unique_id": x.customer_unique_id.strip(),
            "zip": x.customer_zip_code_prefix,
            "city": x.customer_city.strip(),
            "state": x.customer_state.upper().strip(),
        },
    )
    db.execute(
        text(
            """INSERT INTO customer_metrics_cache 
               (customer_id, customer_unique_id, recency_days, frequency, monetary_total, avg_review_score, segment) 
               VALUES (:id, :unique_id, 0, 0, 0.00, 0.00, 'Low Risk')"""
        ),
        {"id": customer_id, "unique_id": x.customer_unique_id.strip()},
    )
    db.add(
        AuditLog(
            customer_id=customer_id,
            action="Created customer",
            performed_by=u.get("sub", "admin"),
            details=f"Created customer with Unique ID: {x.customer_unique_id}, City: {x.customer_city}, State: {x.customer_state.upper()}",
            created_at=datetime.now(timezone.utc),
        )
    )
    db.commit()
    return {
        "customer_id": customer_id,
        **x.model_dump(),
        "customer_state": x.customer_state.upper(),
    }


# ------------------------------------------------------------------------------
# 3. Stream / Export Matching Customers to CSV
# ------------------------------------------------------------------------------
@router.get("/api/customers/export")
def export_all_customers_csv(
    q: str = "",
    state: str = "",
    segment: str = "",
    activity: str = "",
    churn_risk: str = "",
    max_recency: int | None = None,
    min_spend: float | None = None,
    min_orders: int | None = None,
    rating: str = "",
    sort_by: str | None = None,
    sort_dir: str | None = None,
    db: Session = Depends(get_db),
    _: str = Depends(auth),
):
    """
    Streams all matching customer rows into a downloadable CSV spreadsheet.
    UI Component: 'Export CSV' button on top of `Customers.jsx`.
    """
    f = ["1=1"]
    p = {}
    if q and str(q).strip():
        f.append("(c.customer_unique_id LIKE :q OR c.customer_city LIKE :q OR c.customer_id LIKE :q)")
        p["q"] = f"%{str(q).strip()}%"
    if state and str(state).strip():
        f.append("c.customer_state=:state")
        p["state"] = str(state).upper()
    if segment:
        f.append(
            "COALESCE(rt.risk_tier, m.segment) COLLATE utf8mb4_unicode_ci "
            "= :segment COLLATE utf8mb4_unicode_ci"
        )
        p["segment"] = segment
    if activity == "active":
        f.append("m.frequency>0")
    elif activity == "inactive":
        f.append("m.frequency=0")
    if max_recency is not None:
        f.append("m.recency_days<=:max_recency")
        p["max_recency"] = max_recency
    if min_spend is not None:
        f.append("m.monetary_total>=:min_spend")
        p["min_spend"] = min_spend
    if min_orders is not None:
        f.append("m.frequency>=:min_orders")
        p["min_orders"] = min_orders
    if churn_risk:
        risk_levels = {part.strip().lower() for part in churn_risk.split(",") if part.strip()}
        risk_conditions = []
        if "high" in risk_levels:
            risk_conditions.append("cp.churn_probability >= 0.70")
        if "medium" in risk_levels:
            risk_conditions.append("(cp.churn_probability >= 0.30 AND cp.churn_probability < 0.70)")
        if "low" in risk_levels:
            risk_conditions.append("cp.churn_probability < 0.30")
        if risk_conditions:
            f.append(f"({' OR '.join(risk_conditions)})")

    selected_ratings = []
    if rating:
        for r_part in rating.split(","):
            r_part = r_part.strip()
            if r_part:
                try:
                    selected_ratings.append(int(float(r_part)))
                except ValueError:
                    pass

    if selected_ratings:
        rating_conds = []
        for r in selected_ratings:
            if r == 1:
                rating_conds.append("(m.avg_review_score >= 1.0 AND m.avg_review_score < 2.0)")
            elif r == 2:
                rating_conds.append("(m.avg_review_score >= 2.0 AND m.avg_review_score < 3.0)")
            elif r == 3:
                rating_conds.append("(m.avg_review_score >= 3.0 AND m.avg_review_score < 4.0)")
            elif r == 4:
                rating_conds.append("(m.avg_review_score >= 4.0 AND m.avg_review_score < 5.0)")
            elif r == 5:
                rating_conds.append("(m.avg_review_score = 5.0)")
        if rating_conds:
            f.append(f"({' OR '.join(rating_conds)})")

    order_clause = "m.monetary_total DESC"
    if sort_by:
        d = "ASC" if str(sort_dir).lower() == "asc" else "DESC"
        if sort_by == "spend":
            order_clause = f"m.monetary_total {d}"
        elif sort_by == "rating":
            order_clause = f"m.avg_review_score {d}"
        elif sort_by == "recency":
            order_clause = f"m.recency_days {d}"
        elif sort_by == "orders":
            order_clause = f"m.frequency {d}"
        elif sort_by == "city":
            order_clause = f"customer_city {d}"

    where = " AND ".join(f)
    rs = db.execute(
        text(
            f"""SELECT 
                c.customer_unique_id,
                MIN(c.customer_city) as customer_city,
                MIN(c.customer_state) as customer_state,
                COALESCE(rt.risk_tier, m.segment) COLLATE utf8mb4_unicode_ci AS segment,
                m.frequency,
                m.monetary_total,
                m.avg_review_score,
                m.recency_days,
                CASE WHEN m.frequency>1 THEN 'Yes' ELSE 'No' END as is_repeat_customer
            FROM customers c 
            JOIN customer_metrics_cache m ON m.customer_id = c.customer_id
            LEFT JOIN {ANALYTICS_DB_NAME}.customer_segments cs
                ON cs.customer_unique_id COLLATE utf8mb4_unicode_ci =
                   c.customer_unique_id COLLATE utf8mb4_unicode_ci
            LEFT JOIN {ANALYTICS_DB_NAME}.customer_risk_tiers rt
                ON rt.customer_unique_id COLLATE utf8mb4_unicode_ci =
                   c.customer_unique_id COLLATE utf8mb4_unicode_ci
            LEFT JOIN {ANALYTICS_DB_NAME}.churn_predictions cp
                ON cp.customer_unique_id COLLATE utf8mb4_unicode_ci =
                   c.customer_unique_id COLLATE utf8mb4_unicode_ci
            WHERE {where} 
            GROUP BY c.customer_unique_id, rt.risk_tier, m.segment, m.frequency, m.monetary_total, m.avg_review_score, m.recency_days
            ORDER BY {order_clause}"""
        ),
        p,
    )

    def iter_csv():
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow([
            "Customer Unique ID",
            "City",
            "State",
            "Segment",
            "Orders (Frequency)",
            "Total Spend (R$)",
            "Avg Rating",
            "Recency (Days)",
            "Repeat Customer",
        ])
        yield output.getvalue()
        output.seek(0)
        output.truncate(0)

        for row in rs:
            writer.writerow([
                row[0],
                row[1] or "",
                row[2] or "",
                row[3] or "",
                row[4] or 0,
                f"{float(row[5] or 0):.2f}",
                f"{float(row[6] or 0):.1f}",
                row[7] or 0,
                row[8] or "No",
            ])
            yield output.getvalue()
            output.seek(0)
            output.truncate(0)

    filename = f"customers_export_full_{datetime.now(timezone.utc).strftime('%Y%m%d')}.csv"
    return StreamingResponse(
        iter_csv(),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )


# ------------------------------------------------------------------------------
# 4. Bulk Update Customer Segments (Admin Only)
# ------------------------------------------------------------------------------
@router.post("/api/customers/bulk-segment")
def bulk_update_segment(
    payload: BulkSegmentUpdateIn,
    db: Session = Depends(get_db),
    u: dict = Depends(admin_auth),
):
    """
    Updates the RFM customer segment for multiple selected customers at once.
    UI Component: Bulk actions bar in `Customers.jsx`.
    """
    if not payload.customer_unique_ids:
        raise HTTPException(400, "No customers selected")
    if payload.segment not in [
        "High Risk",
        "Medium Risk",
        "Low Risk",
    ]:
        raise HTTPException(400, "Invalid segment value")

    for uid in payload.customer_unique_ids:
        db.execute(
            text(
                """UPDATE customer_metrics_cache 
                SET segment = :seg 
                WHERE customer_id IN (SELECT customer_id FROM customers WHERE customer_unique_id = :uid)
                   OR customer_unique_id = :uid"""
            ),
            {"seg": payload.segment, "uid": uid},
        )
        db.add(
            AuditLog(
                customer_id=uid,
                action="Bulk Updated Segment",
                performed_by=u.get("sub", "admin"),
                details=f"Bulk updated customer segment to '{payload.segment}'",
                created_at=datetime.now(timezone.utc),
            )
        )
    db.commit()
    return {"updated_count": len(payload.customer_unique_ids), "segment": payload.segment}


# ------------------------------------------------------------------------------
# 5. Bulk Delete Customers (Admin Only)
# ------------------------------------------------------------------------------
@router.post("/api/customers/bulk-delete")
def bulk_delete_customers(
    payload: BulkDeleteIn,
    db: Session = Depends(get_db),
    u: dict = Depends(admin_auth),
):
    """
    Safely deletes multiple selected customers (skips customers with order history).
    UI Component: Bulk actions bar in `Customers.jsx`.
    """
    if not payload.customer_unique_ids:
        raise HTTPException(400, "No customers selected")

    deleted_count = 0
    skipped_count = 0

    for uid in payload.customer_unique_ids:
        has_orders = db.execute(
            text("SELECT 1 FROM orders o JOIN customers c ON c.customer_id=o.customer_id WHERE c.customer_unique_id=:uid LIMIT 1"),
            {"uid": uid},
        ).fetchone()
        if has_orders:
            skipped_count += 1
            continue

        db.execute(
            text(
                """DELETE FROM customer_metrics_cache 
                WHERE customer_id IN (SELECT customer_id FROM customers WHERE customer_unique_id = :uid)
                   OR customer_unique_id = :uid"""
            ),
            {"uid": uid},
        )
        db.execute(
            text(
                """DELETE FROM customer_features 
                WHERE customer_id IN (SELECT customer_id FROM customers WHERE customer_unique_id = :uid)"""
            ),
            {"uid": uid},
        )
        db.execute(
            text("DELETE FROM customers WHERE customer_unique_id = :uid"),
            {"uid": uid},
        )
        db.add(
            AuditLog(
                customer_id=uid,
                action="Bulk Deleted Customer",
                performed_by=u.get("sub", "admin"),
                details=f"Customer {uid} deleted in bulk operation.",
                created_at=datetime.now(timezone.utc),
            )
        )
        deleted_count += 1

    db.commit()
    return {"deleted_count": deleted_count, "skipped_count": skipped_count}


# ------------------------------------------------------------------------------
# 6. Single Customer Deep-Dive Intelligence Profile
# ------------------------------------------------------------------------------
@router.get("/api/customers/{cid}")
def customer_detail(cid: str, db: Session = Depends(get_db), _: str = Depends(auth)):
    """
    Fetches full customer analytics, RFM metrics, category shares, and payment preferences.
    UI Component: `Customer.jsx` individual profile page.
    """
    r = db.execute(
        text(
            f"""SELECT
            c.customer_id,
            c.customer_unique_id,
            c.customer_zip_code_prefix,
            c.customer_city,
            c.customer_state,
            cf.tenure_days,
            cf.monetary_avg,
            cf.weekend_order_ratio,
            cf.avg_order_value_per_day_active,
            cf.cat_share_beauty,
            cf.cat_share_books,
            cf.cat_share_electronics,
            cf.cat_share_fashion,
            cf.cat_share_home,
            cf.cat_share_sports,
            COALESCE(m.recency_days, 0) AS recency_days,
            COALESCE(m.frequency, 0) AS frequency,
            COALESCE(m.monetary_total, 0) AS monetary_total,
            COALESCE(m.avg_review_score, 0) AS avg_review_score,
            COALESCE(rt.risk_tier, m.segment) COLLATE utf8mb4_unicode_ci AS segment,
            ROUND(cp.churn_probability * 100, 2) AS churn_percentage,
            CASE WHEN COALESCE(m.frequency, 0) > 1 THEN 1 ELSE 0 END AS is_repeat_customer,
            COALESCE((
                SELECT AVG(DATEDIFF(o.order_delivered_customer_date, o.order_purchase_timestamp))
                FROM orders o
                JOIN customers delivery_customer
                    ON delivery_customer.customer_id = o.customer_id
                WHERE delivery_customer.customer_unique_id = c.customer_unique_id
                  AND o.order_status = 'delivered'
                  AND o.order_delivered_customer_date IS NOT NULL
                  AND o.order_purchase_timestamp IS NOT NULL
            ), 0) AS avg_delivery_days
            FROM customers c 
            JOIN customer_metrics_cache m ON m.customer_id = c.customer_id
            LEFT JOIN customer_features cf ON (cf.customer_id = c.customer_id OR cf.customer_id = c.customer_unique_id)
            LEFT JOIN {ANALYTICS_DB_NAME}.customer_segments cs
                ON cs.customer_unique_id COLLATE utf8mb4_unicode_ci =
                   c.customer_unique_id COLLATE utf8mb4_unicode_ci
            LEFT JOIN {ANALYTICS_DB_NAME}.customer_risk_tiers rt
                ON rt.customer_unique_id COLLATE utf8mb4_unicode_ci =
                   c.customer_unique_id COLLATE utf8mb4_unicode_ci
            LEFT JOIN {ANALYTICS_DB_NAME}.churn_predictions cp
                ON cp.customer_unique_id COLLATE utf8mb4_unicode_ci =
                   c.customer_unique_id COLLATE utf8mb4_unicode_ci
            WHERE c.customer_unique_id = :id OR c.customer_id = :id LIMIT 1"""
        ),
        {"id": cid},
    ).fetchone()
    if not r:
        raise HTTPException(404, "Customer not found")
    data = {k: ser(v) for k, v in r._mapping.items()}

    stats = db.execute(
        text(
            """WITH cust_orders AS (
                SELECT DISTINCT
                    o.order_id,
                    o.order_purchase_timestamp,
                    DATE(o.order_purchase_timestamp) AS order_date,
                    DAYOFWEEK(o.order_purchase_timestamp) AS day_of_week
                FROM customers c
                JOIN orders o ON o.customer_id = c.customer_id
                WHERE c.customer_unique_id = :id OR c.customer_id = :id
            ),
            order_values AS (
                SELECT
                    co.order_id,
                    co.order_purchase_timestamp,
                    co.order_date,
                    co.day_of_week,
                    COALESCE(SUM(oi.price), 0) AS order_val
                FROM cust_orders co
                LEFT JOIN order_items oi ON oi.order_id = co.order_id
                GROUP BY co.order_id, co.order_purchase_timestamp, co.order_date, co.day_of_week
            )
            SELECT
                DATEDIFF(MAX(order_purchase_timestamp), MIN(order_purchase_timestamp)) AS tenure_days,
                COALESCE(AVG(order_val), 0) AS monetary_avg,
                COALESCE(SUM(CASE WHEN day_of_week IN (1, 7) THEN 1.0 ELSE 0.0 END) / NULLIF(COUNT(*), 0), 0) AS weekend_order_ratio,
                COALESCE(SUM(order_val) / NULLIF(COUNT(DISTINCT order_date), 0), 0) AS avg_order_value_per_day_active,
                COUNT(*) AS total_orders
            FROM order_values"""
        ),
        {"id": cid},
    ).fetchone()

    if stats:
        s_map = stats._mapping
        data["tenure_days"] = int(s_map["tenure_days"]) if s_map["tenure_days"] is not None else 0
        data["monetary_avg"] = float(s_map["monetary_avg"]) if s_map["monetary_avg"] is not None else 0.0
        data["weekend_order_ratio"] = float(s_map["weekend_order_ratio"]) if s_map["weekend_order_ratio"] is not None else 0.0
        data["avg_order_value_per_day_active"] = float(s_map["avg_order_value_per_day_active"]) if s_map["avg_order_value_per_day_active"] is not None else 0.0
        data["has_order_history"] = (s_map["total_orders"] or 0) > 0
    else:
        data["has_order_history"] = False

    cats = db.execute(
        text(
            """SELECT
            COALESCE(p.product_category_name, 'Other') AS cat,
            COUNT(*) AS cnt
        FROM customers c
        JOIN orders o ON o.customer_id = c.customer_id
        JOIN order_items oi ON oi.order_id = o.order_id
        LEFT JOIN products p ON p.product_id = oi.product_id
        WHERE c.customer_unique_id = :id OR c.customer_id = :id
        GROUP BY COALESCE(p.product_category_name, 'Other')
        ORDER BY cnt DESC
        LIMIT 6"""
        ),
        {"id": cid},
    ).fetchall()
    total_items = sum(row[1] for row in cats) if cats else 0
    if total_items > 0:
        data["top_categories"] = [
            {"label": row[0].replace("_", " ").title(), "share": float(row[1] / total_items)}
            for row in cats
        ]
    else:
        data["top_categories"] = []

    pm = db.execute(
        text(
            """SELECT
            op.payment_type,
            COUNT(*) as count,
            COALESCE(SUM(op.payment_value), 0) as total_val
        FROM customers c
        JOIN orders o ON o.customer_id = c.customer_id
        JOIN order_payments op ON op.order_id = o.order_id
        WHERE (c.customer_unique_id = :id OR c.customer_id = :id) AND op.payment_type != 'not_defined'
        GROUP BY op.payment_type
        ORDER BY count DESC"""
        ),
        {"id": cid},
    ).fetchall()
    total_pm_count = sum(row[1] for row in pm) if pm else 0
    if total_pm_count > 0:
        data["payment_preferences"] = [
            {
                "type": row[0],
                "label": row[0].replace("_", " ").title(),
                "count": int(row[1]),
                "share": float(row[1] / total_pm_count),
                "total_value": float(row[2]),
            }
            for row in pm
        ]
    else:
        data["payment_preferences"] = []

    # Calculate formal Customer Lifetime Value (CLV):
    # CLV = Realized Total Spend * Segment Value Multiplier
    customer_spend = float(data.get("monetary_total") or 0.0)
    data["customer_lifetime_value"] = round(customer_spend, 2)

    return data


# ------------------------------------------------------------------------------
# 7. Update Customer Profile (Admin Only)
# ------------------------------------------------------------------------------
@router.patch("/api/customers/{cid}")
def update_customer(
    cid: str,
    x: CustomerIn,
    db: Session = Depends(get_db),
    u: dict = Depends(admin_auth),
):
    """
    Updates city, state, zip code, or unique identifier with automated audit logging.
    UI Component: 'Edit Customer' modal popup.
    """
    prev = db.execute(
        text("SELECT * FROM customers WHERE customer_unique_id=:id OR customer_id=:id LIMIT 1"), {"id": cid}
    ).fetchone()
    if not prev:
        raise HTTPException(404, "Customer not found")
    prev_map = prev._mapping
    actual_cid = prev_map.get("customer_id")
    actual_unique_id = prev_map.get("customer_unique_id")

    changes = []
    if prev_map.get("customer_unique_id") != x.customer_unique_id:
        changes.append(
            f"Unique ID: '{prev_map.get('customer_unique_id')}' → '{x.customer_unique_id}'"
        )
    if prev_map.get("customer_city") != x.customer_city:
        changes.append(
            f"City: '{prev_map.get('customer_city')}' → '{x.customer_city}'"
        )
    if prev_map.get("customer_state") != x.customer_state.upper():
        changes.append(
            f"State: '{prev_map.get('customer_state')}' → '{x.customer_state.upper()}'"
        )
    if prev_map.get("customer_zip_code_prefix") != x.customer_zip_code_prefix:
        changes.append(
            f"Zip Code: '{prev_map.get('customer_zip_code_prefix')}' → '{x.customer_zip_code_prefix}'"
        )

    # Check if segment changed
    prev_segment_row = db.execute(
        text("SELECT segment FROM customer_metrics_cache WHERE customer_id=:id OR customer_unique_id=:uid LIMIT 1"),
        {"id": actual_cid, "uid": actual_unique_id},
    ).fetchone()
    prev_segment = prev_segment_row[0] if prev_segment_row else None

    if x.segment and x.segment != prev_segment:
        orig_seg = prev_segment if prev_segment else "None"
        changes.append(f"Segment: '{orig_seg}' → '{x.segment}'")
        db.execute(
            text(
                """UPDATE customer_metrics_cache 
                SET segment = :seg 
                WHERE customer_id = :id OR customer_unique_id = :uid"""
            ),
            {"id": actual_cid, "uid": actual_unique_id, "seg": x.segment},
        )

    db.execute(
        text(
            """UPDATE customers 
            SET customer_unique_id=:uid, customer_zip_code_prefix=:zip, customer_city=:city, customer_state=:state 
            WHERE customer_id=:id"""
        ),
        {
            "id": actual_cid,
            "uid": x.customer_unique_id,
            "zip": x.customer_zip_code_prefix,
            "city": x.customer_city,
            "state": x.customer_state.upper(),
        },
    )
    if prev_map.get("customer_unique_id") != x.customer_unique_id:
        db.execute(
            text(
                "UPDATE customer_metrics_cache SET customer_unique_id=:uid WHERE customer_id=:id"
            ),
            {"id": actual_cid, "uid": x.customer_unique_id},
        )
    if actual_unique_id:
        db.execute(
            text("UPDATE audit_logs SET customer_id=:uid WHERE customer_id=:id"),
            {"id": actual_unique_id, "uid": x.customer_unique_id},
        )
        db.execute(
            text(
                "UPDATE consumer_interactions SET customer_id=:uid WHERE customer_id=:id"
            ),
            {"id": actual_unique_id, "uid": x.customer_unique_id},
        )

    db.add(
        AuditLog(
            customer_id=x.customer_unique_id,
            action="Updated customer details",
            performed_by=u.get("sub", "admin"),
            details="; ".join(changes) if changes else "Updated customer with no field changes",
            created_at=datetime.now(timezone.utc),
        )
    )
    db.commit()
    return {
        "customer_id": actual_cid,
        "customer_unique_id": x.customer_unique_id,
        **x.model_dump(),
        "customer_state": x.customer_state.upper(),
    }


# ------------------------------------------------------------------------------
# 8. Delete Customer Profile (Admin Only)
# ------------------------------------------------------------------------------
@router.delete("/api/customers/{cid}")
def delete_customer(
    cid: str, db: Session = Depends(get_db), _: dict = Depends(admin_auth)
):
    """
    Deletes customer if they have no order history (prevents data corruption).
    UI Component: 'Delete Customer' button in `Customer.jsx`.
    """
    cust = db.execute(
        text("SELECT customer_id, customer_unique_id FROM customers WHERE customer_unique_id=:id OR customer_id=:id LIMIT 1"), {"id": cid}
    ).fetchone()
    if not cust:
        raise HTTPException(404, "Customer not found")
    actual_cid = cust._mapping.get("customer_id")
    actual_unique_id = cust._mapping.get("customer_unique_id")

    linked_orders = db.execute(
        text("SELECT 1 FROM orders WHERE customer_id=:id LIMIT 1"), {"id": actual_cid}
    ).first()
    if linked_orders:
        raise HTTPException(409, "Customers with order history cannot be deleted.")
    db.execute(
        text("DELETE FROM audit_logs WHERE customer_id=:id OR customer_id=:uid"), {"id": actual_cid, "uid": actual_unique_id}
    )
    db.execute(
        text("DELETE FROM customer_metrics_cache WHERE customer_id=:id OR customer_unique_id=:uid"), {"id": actual_cid, "uid": actual_unique_id}
    )
    db.execute(
        text("DELETE FROM consumer_interactions WHERE customer_id=:id OR customer_id=:uid"), {"id": actual_cid, "uid": actual_unique_id}
    )
    db.execute(text("DELETE FROM customer_features WHERE customer_id=:id OR customer_id=:uid"), {"id": actual_cid, "uid": actual_unique_id})
    db.execute(text("DELETE FROM customers WHERE customer_id=:id"), {"id": actual_cid})
    db.commit()
    return {"deleted": True, "customer_id": actual_cid}
