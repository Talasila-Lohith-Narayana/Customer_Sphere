from app.api.dashboard.router import _customer_churn_segments


def test_dashboard_risk_bands_are_derived_from_model_probability():
    class Result:
        def fetchall(self):
            return []

    class Database:
        statement = ""

        def execute(self, statement, params):
            self.statement = str(statement)
            assert params == {"start_ts": "2018-01-01 00:00:00"}
            return Result()

    db = Database()
    _customer_churn_segments(
        db,
        "WHERE o.order_purchase_timestamp >= :start_ts",
        {"start_ts": "2018-01-01 00:00:00"},
    )

    assert "scored.churn_probability >= 0.70" in db.statement
    assert "scored.churn_probability >= 0.30" in db.statement
    assert "MAX(cp.churn_probability)" in db.statement
    assert "customer_risk_tiers" not in db.statement
    assert "COUNT(*) AS count" in db.statement


def test_dashboard_summary_default(client, admin_headers):
    """Verifies that the default dashboard summary endpoint returns 200 and churn risk bands."""
    response = client.get("/api/dashboard/summary", headers=admin_headers)
    assert response.status_code == 200
    data = response.json()

    # Core sections
    assert "kpis" in data
    assert "segments" in data
    assert "monthly" in data
    assert "categories" in data
    assert "top_states" in data
    assert "payments" in data
    assert "ratings_dist" in data
    assert data["timeframe"] == "all"

    # KPI structure
    kpis = data["kpis"]
    for expected_field in [
        "customers",
        "orders",
        "revenue",
        "reviews",
        "avg_rating",
        "repeat_customers",
        "repeat_rate",
        "avg_order_value",
        "avg_delivery_days",
    ]:
        assert expected_field in kpis
        assert kpis[expected_field] is not None


def test_dashboard_summary_viewer_access(client, viewer_headers):
    """Verifies that analyst/viewer users have read permission on the dashboard."""
    response = client.get("/api/dashboard/summary", headers=viewer_headers)
    assert response.status_code == 200
    assert "kpis" in response.json()


def test_dashboard_core_summary_only_returns_initial_data(client, admin_headers):
    response = client.get(
        "/api/dashboard/summary?sections=core",
        headers=admin_headers,
    )
    assert response.status_code == 200
    data = response.json()
    assert "kpis" in data
    assert data["timeframe"] == "all"
    assert "monthly" not in data
    assert "geo_distribution" not in data


def test_dashboard_summary_rejects_unknown_sections(client, admin_headers):
    response = client.get(
        "/api/dashboard/summary?sections=unknown",
        headers=admin_headers,
    )
    assert response.status_code == 422


def test_dashboard_deferred_sections_require_known_section(client, admin_headers):
    response = client.get(
        "/api/dashboard/sections/unknown",
        headers=admin_headers,
    )
    assert response.status_code == 404


def test_dashboard_deferred_sections_return_expected_payloads(client, admin_headers):
    expected_keys = {
        "trends": {"monthly", "segments"},
        "geography": {"geo_distribution", "top_states", "top_cities"},
    }

    for section, keys in expected_keys.items():
        response = client.get(
            f"/api/dashboard/sections/{section}?timeframe=2018",
            headers=admin_headers,
        )
        assert response.status_code == 200
        assert keys <= response.json().keys()


def test_dashboard_summary_presets(client, admin_headers):
    """Verifies dashboard time presets (2018, 2017, l6m, l30d)."""
    for preset in ["2018", "2017", "l6m", "l30d"]:
        response = client.get(f"/api/dashboard/summary?timeframe={preset}", headers=admin_headers)
        assert response.status_code == 200
        data = response.json()
        assert data["timeframe"] == preset
        assert "kpis" in data


def test_dashboard_summary_custom_range(client, admin_headers):
    """Verifies parameterized custom date range filtering."""
    response = client.get(
        "/api/dashboard/summary?timeframe=custom&start_date=2017-01-01&end_date=2017-06-30",
        headers=admin_headers,
    )
    assert response.status_code == 200
    data = response.json()
    assert data["timeframe"] == "custom"
    assert "kpis" in data


def test_dashboard_geo_distribution_and_cities(client, admin_headers):
    """Verifies that dashboard summary returns geo_distribution and top_cities."""
    response = client.get("/api/dashboard/summary", headers=admin_headers)
    assert response.status_code == 200
    data = response.json()

    assert "geo_distribution" in data
    assert "top_cities" in data

    # Must contain Brazilian states
    geo = data["geo_distribution"]
    assert len(geo) == 27
    assert len(data["top_states"]) == len(geo)
    first = geo[0]
    for key in ["state", "name", "region", "capital", "customers", "orders", "revenue", "aov", "pct_revenue"]:
        assert key in first

    # Top cities check
    cities = data["top_cities"]
    assert len(cities) > 0
    first_city = cities[0]
    for key in ["city", "state", "customers", "orders", "revenue"]:
        assert key in first_city


def test_dashboard_state_detail(client, admin_headers):
    """Verifies state drilldown endpoint for a valid state (SP) and invalid state."""
    # Valid state
    response = client.get("/api/dashboard/geo/state/SP", headers=admin_headers)
    assert response.status_code == 200
    sp_data = response.json()
    assert sp_data["state"] == "SP"
    assert sp_data["name"] == "São Paulo"
    assert sp_data["region"] == "Southeast"
    assert sp_data["capital"] == "São Paulo"
    assert sp_data["customers"] > 0
    assert sp_data["orders"] > 0
    assert sp_data["revenue"] > 0
    assert "top_cities" in sp_data
    assert "top_categories" in sp_data
    assert len(sp_data["top_cities"]) > 0

    # Case insensitivity
    response_lower = client.get("/api/dashboard/geo/state/rj", headers=admin_headers)
    assert response_lower.status_code == 200
    assert response_lower.json()["state"] == "RJ"

    # Nonexistent state
    response_invalid = client.get("/api/dashboard/geo/state/ZZ", headers=admin_headers)
    assert response_invalid.status_code == 404



def test_dashboard_summary_comparison_repeat_rate(client, admin_headers):
    """Verifies that period comparison computes repeat_rate delta and percentage change correctly."""
    response = client.get("/api/dashboard/summary?timeframe=2018&compare_to=2017", headers=admin_headers)
    assert response.status_code == 200
    data = response.json()
    assert "comparison" in data
    comp = data["comparison"]
    assert "repeat_rate" in comp
    assert "current" in comp["repeat_rate"]
    assert "previous" in comp["repeat_rate"]
    assert "delta" in comp["repeat_rate"]
    assert "pct_change" in comp["repeat_rate"]
