import json
from types import SimpleNamespace

from app.api.predictions import router as predictions


class RecordingSession:
    def __init__(self):
        self.statements = []
        self.committed = False

    def execute(self, statement, params=None):
        sql = str(statement)
        params = params or {}
        self.statements.append((sql, params))

        if f"UPDATE {predictions.ANALYTICS_DB_NAME}.customer_clv" in sql:
            return SimpleNamespace(rowcount=0)
        if f"SELECT 1 FROM {predictions.ANALYTICS_DB_NAME}.customer_clv" in sql:
            return SimpleNamespace(first=lambda: None)
        if "SELECT 1" in sql and "customer_metrics_cache" in sql:
            return SimpleNamespace(first=lambda: (1,))
        return SimpleNamespace(rowcount=0)

    def commit(self):
        self.committed = True


def test_manual_rescore_persists_shap_and_clv_for_new_customer(monkeypatch):
    fresh_predictions = {
        "customer_unique_id": "new-customer",
        "has_ml_data": True,
        "is_realtime_score": True,
        "churn": {
            "probability": 0.42,
            "model_version": "v1",
            "scored_at": "2026-10-30T00:00:00+00:00",
        },
        "explainability": {
            "shap_drivers": [
                {"feature": "monetary_value", "impact": 0.31},
                {"feature": "avg_review_score", "impact": -0.12},
            ],
            "reason_codes": [{"code": "RC01"}],
        },
        "clv": {
            "predicted_clv": 250.0,
            "value_tier": "Medium",
            "purchase_frequency_per_year": 1.0,
            "customer_lifespan_years": 1.0,
        },
        "segmentation": {"segment_label": "Medium Risk"},
    }
    db = RecordingSession()
    monkeypatch.setattr(
        predictions, "_compute_realtime_prediction", lambda _db, _uid: fresh_predictions
    )

    result = predictions.rescore_customer_manually("new-customer", db=db, _={})

    assert result is fresh_predictions
    assert db.committed
    churn_insert = next(
        (sql, params)
        for sql, params in db.statements
        if f"INSERT INTO {predictions.ANALYTICS_DB_NAME}.churn_predictions" in sql
    )
    assert json.loads(churn_insert[1]["shap_values"]) == {
        "monetary_value": 0.31,
        "avg_review_score": -0.12,
    }
    clv_insert = next(
        (sql, params)
        for sql, params in db.statements
        if f"INSERT INTO {predictions.ANALYTICS_DB_NAME}.customer_clv" in sql
    )
    assert clv_insert[1] == {
        "customer_unique_id": "new-customer",
        "purchase_frequency_per_year": 1.0,
        "customer_lifespan_years": 1.0,
        "clv": 250.0,
        "value_tier": "Medium",
    }


def test_persist_customer_clv_updates_existing_row():
    statements = []

    class ExistingClvSession:
        def execute(self, statement, params=None):
            sql = str(statement)
            statements.append((sql, params or {}))
            return SimpleNamespace(rowcount=1)

    predictions._persist_customer_clv(
        ExistingClvSession(),
        "existing-customer",
        {
            "predicted_clv": 125.0,
            "value_tier": "Low",
            "purchase_frequency_per_year": 2.0,
            "customer_lifespan_years": 1.5,
        },
    )

    assert len(statements) == 1
    assert f"UPDATE {predictions.ANALYTICS_DB_NAME}.customer_clv" in statements[0][0]
    assert statements[0][1]["clv"] == 125.0
