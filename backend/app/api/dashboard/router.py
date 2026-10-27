from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import text
from app.core.auth import auth
from app.core.database import ANALYTICS_DB_NAME, get_db
from app.core.serialization import rows, ser

router = APIRouter(tags=["dashboard"])

BRAZILIAN_STATES_META = {
    "AC": {"name": "Acre", "region": "North", "capital": "Rio Branco"},
    "AL": {"name": "Alagoas", "region": "Northeast", "capital": "Maceió"},
    "AP": {"name": "Amapá", "region": "North", "capital": "Macapá"},
    "AM": {"name": "Amazonas", "region": "North", "capital": "Manaus"},
    "BA": {"name": "Bahia", "region": "Northeast", "capital": "Salvador"},
    "CE": {"name": "Ceará", "region": "Northeast", "capital": "Fortaleza"},
    "DF": {"name": "Distrito Federal", "region": "Central-West", "capital": "Brasília"},
    "ES": {"name": "Espírito Santo", "region": "Southeast", "capital": "Vitória"},
    "GO": {"name": "Goiás", "region": "Central-West", "capital": "Goiânia"},
    "MA": {"name": "Maranhão", "region": "Northeast", "capital": "São Luís"},
    "MT": {"name": "Mato Grosso", "region": "Central-West", "capital": "Cuiabá"},
    "MS": {"name": "Mato Grosso do Sul", "region": "Central-West", "capital": "Campo Grande"},
    "MG": {"name": "Minas Gerais", "region": "Southeast", "capital": "Belo Horizonte"},
    "PA": {"name": "Pará", "region": "North", "capital": "Belém"},
    "PB": {"name": "Paraíba", "region": "Northeast", "capital": "João Pessoa"},
    "PR": {"name": "Paraná", "region": "South", "capital": "Curitiba"},
    "PE": {"name": "Pernambuco", "region": "Northeast", "capital": "Recife"},
    "PI": {"name": "Piauí", "region": "Northeast", "capital": "Teresina"},
    "RJ": {"name": "Rio de Janeiro", "region": "Southeast", "capital": "Rio de Janeiro"},
    "RN": {"name": "Rio Grande do Norte", "region": "Northeast", "capital": "Natal"},
    "RS": {"name": "Rio Grande do Sul", "region": "South", "capital": "Porto Alegre"},
    "RO": {"name": "Rondônia", "region": "North", "capital": "Porto Velho"},
    "RR": {"name": "Roraima", "region": "North", "capital": "Boa Vista"},
    "SC": {"name": "Santa Catarina", "region": "South", "capital": "Florianópolis"},
    "SP": {"name": "São Paulo", "region": "Southeast", "capital": "São Paulo"},
    "SE": {"name": "Sergipe", "region": "Northeast", "capital": "Aracaju"},
    "TO": {"name": "Tocantins", "region": "North", "capital": "Palmas"},
}


# ------------------------------------------------------------------------------
# Helper: Build timeframe WHERE clause from a timeframe key
# ------------------------------------------------------------------------------
def _build_time_filter(tf, sd=None, ed=None, param_prefix=""):
    """Returns (where_clause_str, params_dict) for a given timeframe."""
    params = {}
    conds = []
    p = param_prefix  # prefix avoids param name collisions in comparison queries

    if tf == "custom" and (sd or ed):
        if sd:
            conds.append(f"o.order_purchase_timestamp >= :{p}start_ts")
            params[f"{p}start_ts"] = f"{sd.strip()} 00:00:00"
        if ed:
            conds.append(f"o.order_purchase_timestamp <= :{p}end_ts")
            params[f"{p}end_ts"] = f"{ed.strip()} 23:59:59"
    elif tf == "2018":
        conds.append("o.order_purchase_timestamp >= '2018-01-01 00:00:00' AND o.order_purchase_timestamp <= '2018-12-31 23:59:59'")
    elif tf == "2017":
        conds.append("o.order_purchase_timestamp >= '2017-01-01 00:00:00' AND o.order_purchase_timestamp <= '2017-12-31 23:59:59'")
    elif tf == "2016":
        conds.append("o.order_purchase_timestamp >= '2016-01-01 00:00:00' AND o.order_purchase_timestamp <= '2016-12-31 23:59:59'")
    elif tf == "l6m":
        conds.append("o.order_purchase_timestamp >= '2018-03-01 00:00:00'")
    elif tf == "l30d":
        conds.append("o.order_purchase_timestamp >= '2018-08-01 00:00:00'")

    where = f"WHERE {' AND '.join(conds)}" if conds else ""
    return where, params


def _customer_churn_segments(db, time_filter_orders, params):
    order_joins = ""
    if time_filter_orders:
        order_joins = """
            JOIN customers cust ON cust.customer_unique_id = c.customer_unique_id
            JOIN orders o ON o.customer_id = cust.customer_id
        """

    return db.execute(
        text(
            f"""SELECT
                CASE
                    WHEN scored.churn_probability >= 0.70 THEN 'High Risk'
                    WHEN scored.churn_probability >= 0.30 THEN 'Medium Risk'
                    ELSE 'Low Risk'
                END AS segment,
                COUNT(*) AS count,
                ROUND(AVG(scored.churn_probability) * 100, 2) AS churn_percentage
            FROM (
                SELECT c.customer_unique_id, MAX(cp.churn_probability) AS churn_probability
                FROM customer_metrics_cache c
                {order_joins}
                JOIN {ANALYTICS_DB_NAME}.churn_predictions cp
                    ON cp.customer_unique_id COLLATE utf8mb4_unicode_ci =
                       c.customer_unique_id COLLATE utf8mb4_unicode_ci
                {time_filter_orders}
                GROUP BY c.customer_unique_id
            ) scored
            GROUP BY segment
            ORDER BY count DESC"""
        ),
        params,
    ).fetchall()


# ------------------------------------------------------------------------------
# Helper: Compute core KPI numbers for a given time filter
# ------------------------------------------------------------------------------
def _compute_kpis(db, time_filter_orders, params):
    """Runs the aggregation queries and returns a KPI dict."""
    delivery_filter = "WHERE o.order_delivered_customer_date IS NOT NULL"
    if time_filter_orders:
        delivery_filter += f" AND {time_filter_orders.replace('WHERE ', '')}"

    health_metrics = db.execute(
        text(
            f"""SELECT 
                AVG(p.payment_value) as aov,
                AVG(DATEDIFF(o.order_delivered_customer_date, o.order_purchase_timestamp)) as avg_delivery_days
            FROM orders o
            JOIN order_payments p ON p.order_id = o.order_id
            {delivery_filter}"""
        ),
        params,
    ).fetchone()

    if time_filter_orders:
        total_customers = db.execute(
            text(f"SELECT COUNT(DISTINCT c.customer_unique_id) FROM customers c JOIN orders o ON o.customer_id = c.customer_id {time_filter_orders}"),
            params,
        ).scalar() or 0
        total_orders = db.execute(
            text(f"SELECT COUNT(*) FROM orders o {time_filter_orders}"),
            params,
        ).scalar() or 0
        total_rev = db.execute(
            text(f"SELECT COALESCE(SUM(p.payment_value),0) FROM order_payments p JOIN orders o ON o.order_id = p.order_id {time_filter_orders}"),
            params,
        ).scalar() or 0
        total_revs = db.execute(
            text(f"SELECT COUNT(*) FROM order_reviews r JOIN orders o ON o.order_id = r.order_id {time_filter_orders}"),
            params,
        ).scalar() or 0
        avg_score = db.execute(
            text(f"SELECT COALESCE(AVG(r.review_score),0) FROM order_reviews r JOIN orders o ON o.order_id = r.order_id {time_filter_orders}"),
            params,
        ).scalar() or 0
        repeat_custs = db.execute(
            text(f"""SELECT COUNT(*) FROM (
                SELECT c.customer_unique_id, COUNT(o.order_id) cnt 
                FROM customers c JOIN orders o ON o.customer_id = c.customer_id 
                {time_filter_orders} GROUP BY c.customer_unique_id HAVING cnt > 1
            ) t"""),
            params,
        ).scalar() or 0
    else:
        total_customers = db.execute(text("SELECT COUNT(DISTINCT customer_unique_id) FROM customers")).scalar() or 0
        total_orders = db.execute(text("SELECT COUNT(*) FROM orders")).scalar() or 0
        total_rev = db.execute(text("SELECT COALESCE(SUM(payment_value),0) FROM order_payments")).scalar() or 0
        total_revs = db.execute(text("SELECT COUNT(*) FROM order_reviews")).scalar() or 0
        avg_score = db.execute(text("SELECT COALESCE(AVG(review_score),0) FROM order_reviews")).scalar() or 0
        repeat_custs = db.execute(
            text("SELECT COUNT(DISTINCT customer_unique_id) FROM customer_metrics_cache WHERE frequency > 1")
        ).scalar() or 0

    repeat_rate = round((repeat_custs / total_customers * 100), 2) if total_customers > 0 else 0.0

    return {
        "customers": total_customers,
        "orders": total_orders,
        "revenue": total_rev,
        "reviews": total_revs,
        "avg_rating": avg_score,
        "repeat_customers": repeat_custs,
        "repeat_rate": repeat_rate,
        "avg_order_value": float(health_metrics[0]) if health_metrics and health_metrics[0] is not None else 0.0,
        "avg_delivery_days": float(health_metrics[1]) if health_metrics and health_metrics[1] is not None else 0.0,
    }


# ------------------------------------------------------------------------------
# Helper: Compute comparison deltas between two KPI dicts
# ------------------------------------------------------------------------------
def _compute_comparison(current_kpis, previous_kpis):
    """Returns a dict with absolute and percentage deltas for each KPI."""
    comparison = {}
    for key in current_kpis:
        cur = float(ser(current_kpis[key]) or 0)
        prev = float(ser(previous_kpis[key]) or 0)
        delta = cur - prev
        pct = ((delta / prev) * 100) if prev != 0 else (100.0 if delta > 0 else 0.0)
        comparison[key] = {
            "current": cur,
            "previous": prev,
            "delta": round(delta, 2),
            "pct_change": round(pct, 1),
        }
    return comparison


def _dashboard_comparison(
    db,
    current_kpis,
    compare_to,
    compare_start_date,
    compare_end_date,
):
    if not compare_to:
        return None

    comp_filter, comp_params = _build_time_filter(
        compare_to, compare_start_date, compare_end_date, param_prefix="cmp_"
    )
    comp_kpis = _compute_kpis(db, comp_filter, comp_params)
    comparison = _compute_comparison(current_kpis, comp_kpis)
    comparison["compare_to"] = compare_to
    return comparison


@router.get("/api/dashboard/summary")
def dashboard(
    timeframe: str = "all",
    start_date: str = None,
    end_date: str = None,
    compare_to: str = None,
    compare_start_date: str = None,
    compare_end_date: str = None,
    sections: str = "all",
    db: Session = Depends(get_db),
    _: str = Depends(auth),
):
    """
    Computes executive metrics for the primary Dashboard view. Set sections=core
    to return only initial KPI/comparison data,
    with optional timeframe horizon filtering ('all', '2018', '2017', '2016', 'l6m', 'l30d', 'custom')
    and custom start_date / end_date range.
    Supports period-over-period comparison via the 'compare_to' parameter.
    UI Component: `Dashboard.jsx`.
    """
    if sections not in {"all", "core"}:
        raise HTTPException(status_code=422, detail="sections must be 'all' or 'core'.")

    # Build primary timeframe filter
    time_filter_orders, params = _build_time_filter(timeframe, start_date, end_date)

    # 1-2. Compute primary KPIs
    k = _compute_kpis(db, time_filter_orders, params)
    comparison = _dashboard_comparison(
        db, k, compare_to, compare_start_date, compare_end_date
    )

    if sections == "core":
        result = {
            "kpis": {k_name: ser(v_val) for k_name, v_val in k.items()},
            "timeframe": timeframe,
        }
        if comparison is not None:
            result["comparison"] = comparison
        return result

    # 3. Model-predicted churn risk distribution
    seg = _customer_churn_segments(db, time_filter_orders, params)

    # 4. Monthly Trend Time-Series
    monthly_where = f"{time_filter_orders} AND o.order_purchase_timestamp IS NOT NULL" if time_filter_orders else "WHERE o.order_purchase_timestamp IS NOT NULL"
    monthly_raw = db.execute(
        text(
            f"""SELECT DATE_FORMAT(o.order_purchase_timestamp,'%Y-%m') month,COUNT(*) orders,COALESCE(SUM(p.payment_value),0) revenue 
            FROM orders o 
            LEFT JOIN order_payments p ON p.order_id=o.order_id 
            {monthly_where} 
            GROUP BY month ORDER BY month"""
        ),
        params,
    ).fetchall()

    monthly_dict = {r[0]: {"orders": int(r[1]), "revenue": float(r[2])} for r in monthly_raw if r[0]}
    all_recorded_months = sorted(list(monthly_dict.keys()))
    monthly_series = []
    if all_recorded_months:
        start_y, start_m = map(int, all_recorded_months[0].split("-"))
        end_y, end_m = map(int, all_recorded_months[-1].split("-"))
        cur_y, cur_m = start_y, start_m
        while (cur_y < end_y) or (cur_y == end_y and cur_m <= end_m):
            m_str = f"{cur_y:04d}-{cur_m:02d}"
            if m_str in monthly_dict:
                monthly_series.append({"month": m_str, **monthly_dict[m_str]})
            else:
                monthly_series.append({"month": m_str, "orders": 0, "revenue": 0.0})
            cur_m += 1
            if cur_m > 12:
                cur_m = 1
                cur_y += 1
    else:
        monthly_series = rows(monthly_raw)

    # 5. Top 8 Product Categories
    cat_order_join = "JOIN orders o ON o.order_id = oi.order_id" if time_filter_orders else ""
    cats = db.execute(
        text(
            f"""SELECT COALESCE(pr.product_category_name,'Unknown') category,COUNT(*) purchases 
            FROM order_items oi 
            {cat_order_join}
            LEFT JOIN products pr ON pr.product_id=oi.product_id 
            {time_filter_orders}
            GROUP BY category ORDER BY purchases DESC LIMIT 8"""
        ),
        params,
    ).fetchall()

    # 6. Geolocation Heatmap: Brazilian States Distribution (all 27 federative units)
    geo_where = f"{time_filter_orders} AND c.customer_state IN ('AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO')" if time_filter_orders else "WHERE c.customer_state IN ('AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO')"
    all_states_raw = db.execute(
        text(
            f"""SELECT 
                c.customer_state as state, 
                COUNT(DISTINCT c.customer_unique_id) as customers, 
                COUNT(DISTINCT o.order_id) as orders,
                COALESCE(SUM(p.payment_value), 0) as revenue
            FROM customers c
            JOIN orders o ON o.customer_id = c.customer_id
            JOIN order_payments p ON p.order_id = o.order_id
            {geo_where}
            GROUP BY c.customer_state
            ORDER BY revenue DESC"""
        ),
        params,
    ).fetchall()

    total_geo_rev = sum(float(r[3]) for r in all_states_raw) or 1.0
    total_geo_cust = sum(int(r[1]) for r in all_states_raw) or 1
    total_geo_orders = sum(int(r[2]) for r in all_states_raw) or 1

    geo_distribution = []
    for r in all_states_raw:
        st_code = r[0]
        cust_cnt = int(r[1])
        ord_cnt = int(r[2])
        rev_val = round(float(r[3]), 2)
        aov_val = round(rev_val / ord_cnt, 2) if ord_cnt > 0 else 0.0
        pct_rev = round((rev_val / total_geo_rev) * 100, 2)
        pct_cust = round((cust_cnt / total_geo_cust) * 100, 2)
        pct_orders = round((ord_cnt / total_geo_orders) * 100, 2)
        meta = BRAZILIAN_STATES_META.get(st_code, {})
        geo_distribution.append({
            "state": st_code,
            "name": meta.get("name", st_code),
            "region": meta.get("region", "Other"),
            "capital": meta.get("capital", ""),
            "customers": cust_cnt,
            "orders": ord_cnt,
            "revenue": rev_val,
            "aov": aov_val,
            "pct_revenue": pct_rev,
            "pct_customers": pct_cust,
            "pct_orders": pct_orders,
        })

    # Include every state with recorded activity so dashboard reach reflects the
    # complete market; the UI can still limit the compact legend independently.
    top_states = [
        {"state": g["state"], "customers": g["customers"], "revenue": g["revenue"]}
        for g in geo_distribution
    ]

    # Top 10 Cities nationwide
    top_cities_raw = db.execute(
        text(
            f"""SELECT 
                c.customer_city as city,
                c.customer_state as state,
                COUNT(DISTINCT c.customer_unique_id) as customers,
                COUNT(DISTINCT o.order_id) as orders,
                ROUND(COALESCE(SUM(p.payment_value), 0), 2) as revenue
            FROM customers c
            JOIN orders o ON o.customer_id = c.customer_id
            JOIN order_payments p ON p.order_id = o.order_id
            {time_filter_orders}
            GROUP BY c.customer_city, c.customer_state
            ORDER BY revenue DESC
            LIMIT 10"""
        ),
        params,
    ).fetchall()

    # 7. Payment Type Distribution
    pay_where = f"WHERE payment_type != 'not_defined' AND {time_filter_orders.replace('WHERE ', '')}" if time_filter_orders else "WHERE payment_type != 'not_defined'"
    payments = db.execute(
        text(
            f"""SELECT p.payment_type as type, COUNT(*) as count, COALESCE(SUM(p.payment_value), 0) as total_value
            FROM order_payments p
            JOIN orders o ON o.order_id = p.order_id
            {pay_where}
            GROUP BY p.payment_type
            ORDER BY count DESC"""
        ),
        params,
    ).fetchall()

    # 8. Star Rating Distribution
    rev_where = f"WHERE r.review_score IS NOT NULL AND {time_filter_orders.replace('WHERE ', '')}" if time_filter_orders else "WHERE r.review_score IS NOT NULL"
    ratings_dist = db.execute(
        text(
            f"""SELECT r.review_score as stars, COUNT(*) as count
            FROM order_reviews r
            JOIN orders o ON o.order_id = r.order_id
            {rev_where}
            GROUP BY r.review_score
            ORDER BY r.review_score DESC"""
        ),
        params,
    ).fetchall()

    # 9. Churn Risk Summary from ML model probabilities
    churn_risk_rows = db.execute(
        text(
            f"""SELECT
                SUM(CASE WHEN cp.churn_probability >= 0.70 THEN 1 ELSE 0 END) as high,
                SUM(CASE WHEN cp.churn_probability >= 0.30 AND cp.churn_probability < 0.70 THEN 1 ELSE 0 END) as medium,
                SUM(CASE WHEN cp.churn_probability < 0.30 THEN 1 ELSE 0 END) as low
            FROM (
                SELECT DISTINCT customer_unique_id
                FROM customer_metrics_cache
            ) scored
            JOIN {ANALYTICS_DB_NAME}.churn_predictions cp
              ON cp.customer_unique_id COLLATE utf8mb4_unicode_ci =
                 scored.customer_unique_id COLLATE utf8mb4_unicode_ci"""
        )
    ).fetchone()
    churn_risk_summary = {
        "high": int(churn_risk_rows[0] or 0) if churn_risk_rows else 0,
        "medium": int(churn_risk_rows[1] or 0) if churn_risk_rows else 0,
        "low": int(churn_risk_rows[2] or 0) if churn_risk_rows else 0,
    }

    result = {
        "kpis": {**{k_name: ser(v_val) for k_name, v_val in k.items()}},
        "segments": rows(seg),
        "monthly": monthly_series,
        "categories": rows(cats),
        "top_states": top_states,
        "geo_distribution": geo_distribution,
        "top_cities": rows(top_cities_raw),
        "payments": rows(payments),
        "ratings_dist": rows(ratings_dist),
        "churn_risk_summary": churn_risk_summary,
        "timeframe": timeframe,
    }
    if comparison is not None:
        result["comparison"] = comparison

    return result


@router.get("/api/dashboard/sections/{section}")
def dashboard_section(
    section: str,
    timeframe: str = "all",
    start_date: str = None,
    end_date: str = None,
    db: Session = Depends(get_db),
    _: str = Depends(auth),
):
    """Return one deferred dashboard section without recomputing core KPIs."""
    if section not in {"trends", "geography"}:
        raise HTTPException(status_code=404, detail="Dashboard section not found.")

    time_filter_orders, params = _build_time_filter(timeframe, start_date, end_date)

    if section == "trends":
        segments_raw = _customer_churn_segments(db, time_filter_orders, params)

        monthly_where = (
            f"{time_filter_orders} AND o.order_purchase_timestamp IS NOT NULL"
            if time_filter_orders
            else "WHERE o.order_purchase_timestamp IS NOT NULL"
        )
        monthly_raw = db.execute(
            text(
                f"""SELECT DATE_FORMAT(o.order_purchase_timestamp,'%Y-%m') month,
                    COUNT(*) orders, COALESCE(SUM(p.payment_value),0) revenue
                FROM orders o
                LEFT JOIN order_payments p ON p.order_id=o.order_id
                {monthly_where}
                GROUP BY month ORDER BY month"""
            ),
            params,
        ).fetchall()

        monthly_dict = {
            row[0]: {"orders": int(row[1]), "revenue": float(row[2])}
            for row in monthly_raw
            if row[0]
        }
        months = sorted(monthly_dict)
        monthly = []
        if months:
            start_year, start_month = map(int, months[0].split("-"))
            end_year, end_month = map(int, months[-1].split("-"))
            year, month = start_year, start_month
            while (year, month) <= (end_year, end_month):
                month_key = f"{year:04d}-{month:02d}"
                monthly.append({
                    "month": month_key,
                    **monthly_dict.get(month_key, {"orders": 0, "revenue": 0.0}),
                })
                month += 1
                if month > 12:
                    month = 1
                    year += 1
        else:
            monthly = rows(monthly_raw)

        return {"segments": rows(segments_raw), "monthly": monthly}

    if section == "geography":
        geo_where = (
            f"{time_filter_orders} AND c.customer_state IN "
            "('AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO')"
            if time_filter_orders
            else "WHERE c.customer_state IN "
            "('AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO')"
        )
        states_raw = db.execute(
            text(
                f"""SELECT c.customer_state as state,
                    COUNT(DISTINCT c.customer_unique_id) as customers,
                    COUNT(DISTINCT o.order_id) as orders,
                    COALESCE(SUM(p.payment_value), 0) as revenue
                FROM customers c
                JOIN orders o ON o.customer_id = c.customer_id
                JOIN order_payments p ON p.order_id = o.order_id
                {geo_where}
                GROUP BY c.customer_state
                ORDER BY revenue DESC"""
            ),
            params,
        ).fetchall()

        total_revenue = sum(float(row[3]) for row in states_raw) or 1.0
        total_customers = sum(int(row[1]) for row in states_raw) or 1
        total_orders = sum(int(row[2]) for row in states_raw) or 1
        geo_distribution = []
        for row in states_raw:
            state_code = row[0]
            customers = int(row[1])
            orders = int(row[2])
            revenue = round(float(row[3]), 2)
            metadata = BRAZILIAN_STATES_META.get(state_code, {})
            geo_distribution.append({
                "state": state_code,
                "name": metadata.get("name", state_code),
                "region": metadata.get("region", "Other"),
                "capital": metadata.get("capital", ""),
                "customers": customers,
                "orders": orders,
                "revenue": revenue,
                "aov": round(revenue / orders, 2) if orders else 0.0,
                "pct_revenue": round(revenue / total_revenue * 100, 2),
                "pct_customers": round(customers / total_customers * 100, 2),
                "pct_orders": round(orders / total_orders * 100, 2),
            })

        top_cities_raw = db.execute(
            text(
                f"""SELECT c.customer_city as city, c.customer_state as state,
                    COUNT(DISTINCT c.customer_unique_id) as customers,
                    COUNT(DISTINCT o.order_id) as orders,
                    ROUND(COALESCE(SUM(p.payment_value), 0), 2) as revenue
                FROM customers c
                JOIN orders o ON o.customer_id = c.customer_id
                JOIN order_payments p ON p.order_id = o.order_id
                {time_filter_orders}
                GROUP BY c.customer_city, c.customer_state
                ORDER BY revenue DESC
                LIMIT 10"""
            ),
            params,
        ).fetchall()
        top_states = [
            {"state": item["state"], "customers": item["customers"], "revenue": item["revenue"]}
            for item in geo_distribution
        ]
        return {
            "geo_distribution": geo_distribution,
            "top_states": top_states,
            "top_cities": rows(top_cities_raw),
        }

    raise HTTPException(status_code=404, detail="Dashboard section not found.")


@router.get("/api/dashboard/geo/state/{state_code}")
def state_detail(
    state_code: str,
    timeframe: str = "all",
    start_date: str = None,
    end_date: str = None,
    db: Session = Depends(get_db),
    _: str = Depends(auth),
):
    """
    Returns deep-dive geographic analytics for a specific Brazilian state,
    including top cities, top product categories, delivery speed, and CSAT rating.
    UI Component: `DashboardGeoHeatmap.jsx`.
    """
    code = state_code.upper().strip()
    if code not in BRAZILIAN_STATES_META:
        raise HTTPException(
            status_code=404,
            detail=f"State '{state_code}' not found in Brazilian territory.",
        )

    meta = BRAZILIAN_STATES_META[code]
    time_filter_orders, params = _build_time_filter(timeframe, start_date, end_date)
    params["st"] = code

    # State-scoped filter
    st_filter = (
        f"{time_filter_orders} AND c.customer_state = :st"
        if time_filter_orders
        else "WHERE c.customer_state = :st"
    )

    # 1. State aggregated metrics
    st_kpis = db.execute(
        text(
            f"""SELECT 
                COUNT(DISTINCT c.customer_unique_id) as customers,
                COUNT(DISTINCT o.order_id) as orders,
                COALESCE(SUM(p.payment_value), 0) as revenue
            FROM customers c
            JOIN orders o ON o.customer_id = c.customer_id
            LEFT JOIN order_payments p ON p.order_id = o.order_id
            {st_filter}"""
        ),
        params,
    ).fetchone()

    cust_cnt = int(st_kpis[0] or 0)
    ord_cnt = int(st_kpis[1] or 0)
    rev_val = round(float(st_kpis[2] or 0.0), 2)
    aov_val = round(rev_val / ord_cnt, 2) if ord_cnt > 0 else 0.0

    # 2. Avg delivery days and CSAT review score
    delivery_filter = f"{st_filter} AND o.order_delivered_customer_date IS NOT NULL"
    perf = db.execute(
        text(
            f"""SELECT 
                AVG(DATEDIFF(o.order_delivered_customer_date, o.order_purchase_timestamp)) as avg_delivery_days,
                AVG(r.review_score) as avg_rating
            FROM customers c
            JOIN orders o ON o.customer_id = c.customer_id
            LEFT JOIN order_reviews r ON r.order_id = o.order_id
            {delivery_filter}"""
        ),
        params,
    ).fetchone()

    avg_del = round(float(perf[0]), 1) if perf and perf[0] is not None else 0.0
    avg_csat = round(float(perf[1]), 2) if perf and perf[1] is not None else 0.0

    # 3. Top 5 Cities in this state
    cities = db.execute(
        text(
            f"""SELECT 
                c.customer_city as city,
                COUNT(DISTINCT c.customer_unique_id) as customers,
                COUNT(DISTINCT o.order_id) as orders,
                ROUND(COALESCE(SUM(p.payment_value), 0), 2) as revenue
            FROM customers c
            JOIN orders o ON o.customer_id = c.customer_id
            LEFT JOIN order_payments p ON p.order_id = o.order_id
            {st_filter}
            GROUP BY c.customer_city
            ORDER BY revenue DESC
            LIMIT 5"""
        ),
        params,
    ).fetchall()

    # 4. Top 5 Product Categories in this state
    categories = db.execute(
        text(
            f"""SELECT 
                COALESCE(pr.product_category_name, 'Unknown') as category,
                COUNT(*) as purchases
            FROM customers c
            JOIN orders o ON o.customer_id = c.customer_id
            JOIN order_items oi ON oi.order_id = o.order_id
            LEFT JOIN products pr ON pr.product_id = oi.product_id
            {st_filter}
            GROUP BY category
            ORDER BY purchases DESC
            LIMIT 5"""
        ),
        params,
    ).fetchall()

    return {
        "state": code,
        "name": meta["name"],
        "region": meta["region"],
        "capital": meta["capital"],
        "customers": cust_cnt,
        "orders": ord_cnt,
        "revenue": rev_val,
        "aov": aov_val,
        "avg_delivery_days": avg_del,
        "avg_rating": avg_csat,
        "top_cities": rows(cities),
        "top_categories": rows(categories),
    }
