import json
from pathlib import Path

import pytest

from app.api.assistant.analytics_tools import (
    parse_analytics_tool_call,
    tool_name_for_metric,
)
from app.api.assistant.service import extract_analytics_intent, select_analytics_domains

EVALUATIONS = json.loads(
    (Path(__file__).parent / "data" / "nova_evaluations.json").read_text(
        encoding="utf-8"
    )
)


def test_nova_evaluation_corpus_has_unique_questions_and_ids():
    assert len(EVALUATIONS) >= 50
    assert len({case["id"] for case in EVALUATIONS}) == len(EVALUATIONS)
    assert len({case["question"] for case in EVALUATIONS}) == len(EVALUATIONS)


@pytest.mark.parametrize("case", EVALUATIONS, ids=lambda case: case["id"])
def test_nova_routing_matches_evaluation(case):
    question = case["question"]
    intent = extract_analytics_intent(question)
    domains = select_analytics_domains(question)

    if case["metric"] is None:
        assert sorted(domains) == case["domains"]
        assert intent is None
        return

    assert set(case["domains"]) <= domains
    assert intent is not None
    assert intent["metric"] == case["metric"]
    assert intent["filters"] == case["filters"]


@pytest.mark.parametrize(
    "case",
    [case for case in EVALUATIONS if case["metric"] is not None],
    ids=lambda case: case["id"],
)
def test_evaluated_metrics_have_validated_safe_tool_plans(case):
    filters = case["filters"]
    metric = case["metric"]
    if metric in {"customers_by_order_count", "customers_by_installments"}:
        field = "order_count" if metric == "customers_by_order_count" else "installments"
        arguments = {
            "operator": filters[field]["operator"],
            "threshold": filters[field]["value"],
        }
    elif metric == "customers_by_spend":
        arguments = {
            "operator": filters["spend"]["operator"],
            "threshold": filters["spend"]["value"],
        }
    elif metric == "customers_by_payment_method":
        arguments = {"payment_method": filters["payment_method"]}
    elif metric == "reviews_by_rating":
        arguments = {
            "operator": filters["rating"]["operator"],
            "rating": filters["rating"]["value"],
        }
    elif metric == "customers_by_product_category":
        arguments = filters
    elif metric == "customers_by_state":
        arguments = filters
    elif metric == "orders_by_delivery_time":
        arguments = {
            "operator": filters["delivery_days"]["operator"],
            "threshold": filters["delivery_days"]["value"],
        }
    else:
        arguments = {}

    tool_name = tool_name_for_metric(metric)
    assert tool_name is not None
    plan = parse_analytics_tool_call(tool_name, arguments)
    normalized_intent = extract_analytics_intent(plan.question)

    assert normalized_intent is not None
    assert normalized_intent["metric"] == metric
    assert normalized_intent["filters"] == filters
    assert set(case["domains"]) <= plan.domains
