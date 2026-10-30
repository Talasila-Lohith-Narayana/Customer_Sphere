import io
import csv
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from sqlalchemy import text
from app.core.auth import auth
from app.core.database import get_db
from app.core.serialization import rows

router = APIRouter(tags=["products"])

# ------------------------------------------------------------------------------
# 1. Global Products Catalog with Search, Filters, Sorting & Pagination
# ------------------------------------------------------------------------------
@router.get("/api/products")
def get_products_catalog(
    q: str = None,
    category: str = None,
    min_price: float = None,
    max_price: float = None,
    min_rating: float = None,
    min_units: int = None,
    sort: str = "items_desc",
    page: int = Query(1, ge=1),
    limit: int = Query(15, ge=1),
    db: Session = Depends(get_db),
    _: str = Depends(auth),
):
    """
    Fetches paginated products with aggregated sales volume, revenue, and star ratings.
    UI Component: `Products.jsx` catalog view.
    """
    where_clauses = []
    params = {}

    if q and q.strip():
        raw_q = q.strip()
        cat_underscored = raw_q.replace(" ", "_")
        where_clauses.append("(p.product_id LIKE :q_raw OR p.product_category_name LIKE :q_raw OR p.product_category_name LIKE :q_under)")
        params["q_raw"] = f"%{raw_q}%"
        params["q_under"] = f"%{cat_underscored}%"

    if category and category.strip():
        where_clauses.append("p.product_category_name = :category")
        params["category"] = category.strip()

    if min_price is not None:
        where_clauses.append("COALESCE(agg.avg_price, 0.0) >= :min_price")
        params["min_price"] = min_price

    if max_price is not None:
        where_clauses.append("COALESCE(agg.avg_price, 0.0) <= :max_price")
        params["max_price"] = max_price

    if min_rating is not None:
        where_clauses.append("COALESCE(agg.avg_rating, 0.0) >= :min_rating")
        params["min_rating"] = min_rating

    if min_units is not None:
        where_clauses.append("COALESCE(agg.total_units_sold, 0) >= :min_units")
        params["min_units"] = min_units

    where_sql = "WHERE " + " AND ".join(where_clauses) if where_clauses else ""
    sort_mapping = {
        "items_desc": "COALESCE(agg.total_units_sold, 0) DESC",
        "items_asc": "COALESCE(agg.total_units_sold, 0) ASC",
        "revenue_desc": "COALESCE(agg.total_revenue, 0) DESC",
        "revenue_asc": "COALESCE(agg.total_revenue, 0) ASC",
        "price_desc": "COALESCE(agg.avg_price, 0) DESC",
        "price_asc": "COALESCE(agg.avg_price, 0) ASC",
        "rating_desc": "COALESCE(agg.avg_rating, 0) DESC",
        "rating_asc": "COALESCE(agg.avg_rating, 0) ASC",
        "category_asc": "category_name ASC",
    }
    order_by_sql = sort_mapping.get(sort, "COALESCE(agg.total_units_sold, 0) DESC")

    offset = (page - 1) * limit
    params["limit"] = limit
    params["offset"] = offset

    query_sql = f"""
        SELECT 
            p.product_id,
            COALESCE(p.product_category_name, 'uncategorized') AS category_name,
            COALESCE(p.product_weight_g, 0) AS weight_g,
            COALESCE(p.product_photos_qty, 1) AS photos_qty,
            COALESCE(agg.total_units_sold, 0) AS total_units_sold,
            COALESCE(agg.total_revenue, 0.0) AS total_revenue,
            COALESCE(agg.avg_price, 0.0) AS avg_price,
            COALESCE(agg.avg_freight, 0.0) AS avg_freight,
            COALESCE(agg.avg_rating, 0.0) AS avg_rating,
            COALESCE(agg.total_reviews, 0) AS total_reviews
        FROM products p
        LEFT JOIN product_metrics_cache agg ON agg.product_id = p.product_id
        {where_sql}
        ORDER BY {order_by_sql}
        LIMIT :limit OFFSET :offset
    """

    count_sql = f"""
        SELECT COUNT(*)
        FROM products p
        LEFT JOIN product_metrics_cache agg ON agg.product_id = p.product_id
        {where_sql}
    """
    total_count = db.execute(text(count_sql), params).scalar() or 0
    products_rows = db.execute(text(query_sql), params).fetchall()

    categories_list = db.execute(
        text("SELECT DISTINCT product_category_name FROM products WHERE product_category_name IS NOT NULL AND product_category_name != '' ORDER BY product_category_name ASC")
    ).fetchall()

    items = []
    for r in products_rows:
        m = r._mapping
        items.append({
            "product_id": m.get("product_id"),
            "category_name": m.get("category_name"),
            "weight_g": m.get("weight_g"),
            "photos_qty": m.get("photos_qty"),
            "total_units_sold": int(m.get("total_units_sold") or 0),
            "total_revenue": float(m.get("total_revenue") or 0.0),
            "avg_price": float(m.get("avg_price") or 0.0),
            "avg_freight": float(m.get("avg_freight") or 0.0),
            "avg_rating": float(m.get("avg_rating") or 0.0),
            "total_reviews": int(m.get("total_reviews") or 0),
        })

    return {
        "items": items,
        "total": total_count,
        "page": page,
        "limit": limit,
        "total_pages": max(1, (total_count + limit - 1) // limit),
        "categories": [c[0] for c in categories_list if c[0]],
    }


# ------------------------------------------------------------------------------
# 2. Export Products Catalog to CSV
# ------------------------------------------------------------------------------
@router.get("/api/products/export")
def export_products_csv(
    q: str = None,
    category: str = None,
    min_price: float = None,
    max_price: float = None,
    min_rating: float = None,
    min_units: int = None,
    sort: str = "items_desc",
    db: Session = Depends(get_db),
    _: str = Depends(auth),
):
    """
    Streams the full catalog matching filters into a CSV spreadsheet.
    UI Component: 'Export CSV' button on `Products.jsx`.
    """
    where_clauses = []
    params = {}

    if q and q.strip():
        raw_q = q.strip()
        cat_underscored = raw_q.replace(" ", "_")
        where_clauses.append("(p.product_id LIKE :q_raw OR p.product_category_name LIKE :q_raw OR p.product_category_name LIKE :q_under)")
        params["q_raw"] = f"%{raw_q}%"
        params["q_under"] = f"%{cat_underscored}%"

    if category and category.strip():
        where_clauses.append("p.product_category_name = :category")
        params["category"] = category.strip()

    if min_price is not None:
        where_clauses.append("COALESCE(agg.avg_price, 0.0) >= :min_price")
        params["min_price"] = min_price

    if max_price is not None:
        where_clauses.append("COALESCE(agg.avg_price, 0.0) <= :max_price")
        params["max_price"] = max_price

    if min_rating is not None:
        where_clauses.append("COALESCE(agg.avg_rating, 0.0) >= :min_rating")
        params["min_rating"] = min_rating

    if min_units is not None:
        where_clauses.append("COALESCE(agg.total_units_sold, 0) >= :min_units")
        params["min_units"] = min_units

    where_sql = "WHERE " + " AND ".join(where_clauses) if where_clauses else ""

    sort_mapping = {
        "items_desc": "COALESCE(agg.total_units_sold, 0) DESC",
        "items_asc": "COALESCE(agg.total_units_sold, 0) ASC",
        "revenue_desc": "COALESCE(agg.total_revenue, 0) DESC",
        "revenue_asc": "COALESCE(agg.total_revenue, 0) ASC",
        "price_desc": "COALESCE(agg.avg_price, 0) DESC",
        "price_asc": "COALESCE(agg.avg_price, 0) ASC",
        "rating_desc": "COALESCE(agg.avg_rating, 0) DESC",
        "rating_asc": "COALESCE(agg.avg_rating, 0) ASC",
        "category_asc": "category_name ASC",
    }
    order_by_sql = sort_mapping.get(sort, "COALESCE(agg.total_units_sold, 0) DESC")

    query_sql = f"""
        SELECT 
            p.product_id,
            COALESCE(p.product_category_name, 'uncategorized') AS category_name,
            COALESCE(p.product_weight_g, 0) AS weight_g,
            COALESCE(p.product_photos_qty, 1) AS photos_qty,
            COALESCE(agg.total_units_sold, 0) AS total_units_sold,
            COALESCE(agg.total_revenue, 0.0) AS total_revenue,
            COALESCE(agg.avg_price, 0.0) AS avg_price,
            COALESCE(agg.avg_freight, 0.0) AS avg_freight,
            COALESCE(agg.avg_rating, 0.0) AS avg_rating,
            COALESCE(agg.total_reviews, 0) AS total_reviews
        FROM products p
        LEFT JOIN product_metrics_cache agg ON agg.product_id = p.product_id
        {where_sql}
        ORDER BY {order_by_sql}
    """

    def iter_csv():
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow([
            "product_id",
            "category_name",
            "units_sold",
            "total_revenue_brl",
            "avg_price_brl",
            "avg_freight_brl",
            "avg_rating",
            "total_reviews",
            "weight_g",
            "photos_qty",
        ])
        yield output.getvalue()
        output.seek(0)
        output.truncate(0)

        result = db.execute(text(query_sql), params)
        for row in result:
            m = row._mapping
            writer.writerow([
                m.get("product_id"),
                m.get("category_name"),
                int(m.get("total_units_sold") or 0),
                f"{float(m.get('total_revenue') or 0.0):.2f}",
                f"{float(m.get('avg_price') or 0.0):.2f}",
                f"{float(m.get('avg_freight') or 0.0):.2f}",
                f"{float(m.get('avg_rating') or 0.0):.1f}",
                int(m.get("total_reviews") or 0),
                int(m.get("weight_g") or 0),
                int(m.get("photos_qty") or 0),
            ])
            yield output.getvalue()
            output.seek(0)
            output.truncate(0)

    filename = f"products_catalog_{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')}.csv"
    return StreamingResponse(
        iter_csv(),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )


# ------------------------------------------------------------------------------
# 3. Customer Products Purchased History
# ------------------------------------------------------------------------------
@router.get("/api/customers/{cid}/products")
def customer_products(cid: str, db: Session = Depends(get_db), _: str = Depends(auth)):
    """
    Fetches all individual product items purchased by a customer across all their orders.
    UI Component: 'Products' table in `Customer.jsx`.
    """
    rs = db.execute(
        text(
            """SELECT oi.product_id,COALESCE(p.product_category_name,'Unknown') category,oi.price,oi.freight_value,oi.order_id,o.order_purchase_timestamp 
            FROM customers c
            JOIN orders o ON o.customer_id = c.customer_id
            JOIN order_items oi ON oi.order_id=o.order_id 
            LEFT JOIN products p ON p.product_id=oi.product_id 
            WHERE c.customer_unique_id=:id OR c.customer_id=:id 
            ORDER BY o.order_purchase_timestamp DESC LIMIT 50"""
        ),
        {"id": cid},
    ).fetchall()
    return {"items": rows(rs)}


# ------------------------------------------------------------------------------
# 4. Fetch Products by Category (For Order Creation Auto-Complete / Selection)
# ------------------------------------------------------------------------------
@router.get("/api/products/by-category")
def get_products_by_category(category: str, limit: int = 50, db: Session = Depends(get_db), _: str = Depends(auth)):
    """
    Fetches specific product IDs available under a category with sample price information.
    UI Component: 'OrderModal.jsx' category product dropdown.
    """
    clean_cat = category.strip().lower()
    res = db.execute(
        text(
            """SELECT p.product_id, p.product_category_name,
                      COALESCE(metrics.avg_price, 50.00) as avg_price
            FROM products p
            LEFT JOIN product_metrics_cache metrics ON metrics.product_id = p.product_id
            WHERE p.product_category_name = :cat
            ORDER BY COALESCE(metrics.total_units_sold, 0) DESC
            LIMIT :limit"""
        ),
        {"cat": clean_cat, "limit": limit},
    ).fetchall()
    return {"items": [{"product_id": r[0], "category": r[1], "avg_price": float(r[2])} for r in res]}
