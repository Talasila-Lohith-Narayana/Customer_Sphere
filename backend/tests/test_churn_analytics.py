import pytest
from fastapi import HTTPException
from sqlalchemy.exc import TimeoutError as SQLAlchemyTimeoutError

from app.api.churn_analytics import repository
from app.api.churn_analytics import router


def test_prediction_values_are_cached_and_can_be_cleared(monkeypatch):
    repository.clear_prediction_values_cache()
    monkeypatch.setattr(repository, "PREDICTION_VALUES_CACHE_TTL", 30)
    fetch_calls = []

    def fetch_all(sql, **kwargs):
        fetch_calls.append(sql)
        return [{"shap_values": "{}", "reason_codes": "[]"}]

    monkeypatch.setattr(repository, "fetch_all", fetch_all)

    assert repository.prediction_values() == repository.prediction_values()
    assert len(fetch_calls) == 1

    repository.clear_prediction_values_cache()
    repository.prediction_values()
    assert len(fetch_calls) == 2

    repository.clear_prediction_values_cache()


def test_probability_distribution_uses_aggregated_bin_counts(monkeypatch):
    monkeypatch.setattr(
        router.repo,
        "probability_distribution",
        lambda db: [
            {"probability_bin": 0, "customer_count": 2},
            {"probability_bin": 9, "customer_count": 1},
            {"probability_bin": None, "customer_count": 3},
        ],
    )

    result = router.probability_distribution(db=object(), _={})

    assert result["total_customers"] == 6
    assert len(result["bins"]) == 10
    assert result["bins"][0]["count"] == 2
    assert result["bins"][9]["count"] == 1
    assert sum(bucket["count"] for bucket in result["bins"]) == 3


def test_churn_overview_combines_panel_data_in_one_request(monkeypatch):
    repository.clear_prediction_values_cache()
    monkeypatch.setattr(repository, "CHURN_OVERVIEW_CACHE_TTL", 0)
    monkeypatch.setattr(
        router.repo,
        "churn_summary",
        lambda threshold, db: {
            "total_customers": 2,
            "avg_churn_probability": 0.25,
            "predicted_churn_customers": 1,
            "refreshed_at": "2026-10-23 10:00:00",
        },
    )
    monkeypatch.setattr(
        router.repo,
        "probability_distribution",
        lambda db: [{"probability_bin": 2, "customer_count": 2}],
    )
    monkeypatch.setattr(
        router.repo,
        "prediction_values",
        lambda db: [
            {
                "shap_values": '{"feature_a": 0.5}',
                "reason_codes": '["RC01"]',
            },
            {
                "shap_values": '{"feature_a": -0.25, "feature_b": 0.75}',
                "reason_codes": '["RC02"]',
            },
        ],
    )

    result = router.churn_overview(db=object(), _={})

    assert result["summary"]["total_customers"] == 2
    assert result["last_refresh"]["last_refreshed_at"] == "2026-10-23 10:00:00"
    assert result["probability_distribution"]["bins"][2]["count"] == 2
    assert result["reason_codes"]["total_reason_codes"] == 2
    assert result["top_features"]["features"][0]["feature"] == "feature_b"
    assert result["feature_importance"]["features"][0]["feature"] == "feature_a"


def test_cached_churn_overview_reuses_loader_result(monkeypatch):
    repository.clear_prediction_values_cache()
    monkeypatch.setattr(repository, "CHURN_OVERVIEW_CACHE_TTL", 30)
    calls = []

    def load_overview():
        calls.append(True)
        return {"summary": {"total_customers": 5}}

    repository.cached_churn_overview(load_overview)
    cached = repository.cached_churn_overview(load_overview)

    assert len(calls) == 1
    assert cached == {"summary": {"total_customers": 5}}

    repository.clear_prediction_values_cache()
    uncached = repository.cached_churn_overview(load_overview)
    assert len(calls) == 2
    assert uncached == {"summary": {"total_customers": 5}}

    repository.clear_prediction_values_cache()


def test_database_pool_timeout_returns_service_unavailable():
    def unavailable():
        raise SQLAlchemyTimeoutError("connection pool exhausted")

    with pytest.raises(HTTPException) as error:
        router._db(unavailable)

    assert error.value.status_code == 503


def test_prediction_values_cache_can_be_disabled(monkeypatch):
    repository.clear_prediction_values_cache()
    monkeypatch.setattr(repository, "PREDICTION_VALUES_CACHE_TTL", 0)
    fetch_calls = []
    monkeypatch.setattr(
        repository,
        "fetch_all",
        lambda sql, **kwargs: fetch_calls.append(sql) or [],
    )

    repository.prediction_values()
    repository.prediction_values()

    assert len(fetch_calls) == 2


def test_fetch_all_uses_request_session_without_checking_out_another_connection(
    monkeypatch,
):
    class Result:
        def mappings(self):
            return self

        def all(self):
            return [{"count": 3}]

    class RequestSession:
        def __init__(self):
            self.executed = []

        def execute(self, statement, params):
            self.executed.append((str(statement), params))
            return Result()

    def unexpected_engine_connect():
        raise AssertionError("Request session should be used instead of engine.connect().")

    monkeypatch.setattr(repository.engine, "connect", unexpected_engine_connect)
    db = RequestSession()

    assert repository.fetch_all("SELECT 3 AS count", db=db) == [{"count": 3}]
    assert len(db.executed) == 1
