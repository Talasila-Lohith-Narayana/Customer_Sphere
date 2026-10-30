import pandas as pd

from app.api.clv_delivery_payments import router as delivery_router


def test_delivery_performance_derives_summary_from_status_groups(monkeypatch):
    query_calls = []
    status_rows = pd.DataFrame(
        [
            {
                "delivery_status": "On time",
                "orders": 3,
                "avg_delivery_days": 10.0,
                "avg_churn_probability": 0.1,
            },
            {
                "delivery_status": "Late",
                "orders": 1,
                "avg_delivery_days": 20.0,
                "avg_churn_probability": 0.2,
            },
        ]
    )

    def fake_query(sql):
        query_calls.append(sql)
        return status_rows

    monkeypatch.setattr(delivery_router, "q", fake_query)

    result = delivery_router.delivery_performance()

    assert len(query_calls) == 1
    assert result["summary"] == {
        "delivered_orders": 4,
        "avg_delivery_days": 12.5,
        "on_time_pct": 75.0,
        "late_pct": 25.0,
    }
    assert result["by_delivery_status"] == status_rows.to_dict(orient="records")
