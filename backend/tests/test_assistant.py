import asyncio
import json

import pytest
from pydantic import ValidationError

from app.api.assistant import router, service
from app.api.assistant.schemas import AssistantQuestion


@pytest.mark.parametrize("question", ["", "   ", "\t\n"])
def test_assistant_rejects_blank_questions(question):
    with pytest.raises(ValidationError):
        AssistantQuestion(question=question)


def test_assistant_limits_question_length():
    with pytest.raises(ValidationError):
        AssistantQuestion(question="x" * 1001)


def test_assistant_trims_question():
    assert AssistantQuestion(question="  campaign summary  ").question == "campaign summary"


@pytest.mark.parametrize(
    ("question", "expected_domains"),
    [
        ("Show monthly revenue trends", {"sales"}),
        ("Which product category sells best?", {"products"}),
        ("How many customers are in each segment?", {"segments"}),
        ("How many customers are high churn risk?", {"churn"}),
        ("Which campaigns target the most customers?", {"campaigns"}),
        ("Compare campaign reach across customer segments", {"campaigns", "segments"}),
        ("Compare product sales and churn", {"products", "sales", "churn"}),
    ],
)
def test_select_analytics_domains(question, expected_domains):
    assert service.select_analytics_domains(question) == expected_domains


@pytest.mark.parametrize("question", ["Hi!", "Tell me a joke"])
def test_unmatched_question_uses_model_without_loading_analytics(monkeypatch, question):
    monkeypatch.setattr(service, "is_configured", lambda: True)

    def fail_if_called(*args, **kwargs):
        raise AssertionError("unmatched questions must not load analytics")

    async def answer_without_analytics(received_question, context):
        assert received_question == question
        assert "No analytics data is relevant" in context["privacy_note"]
        return "Model-generated response."

    monkeypatch.setattr(service, "load_analytics_context", fail_if_called)
    monkeypatch.setattr(service, "generate_answer", answer_without_analytics)

    answer = asyncio.run(
        router.ask_assistant(AssistantQuestion(question=question), db=None, _={})
    )

    assert answer.answer == "Model-generated response."
    assert answer.visualizations == []


def test_load_analytics_context_only_queries_selected_domain(monkeypatch):
    called_queries = []

    def fake_records(db, query, limit=None):
        called_queries.append(query)
        if "average_order_value" in query:
            return [{"orders": 12, "revenue": 100, "average_order_value": 8.3}]
        return [{"month": "2026-01", "orders": 12, "revenue": 100}]

    monkeypatch.setattr(service, "_records", fake_records)

    context = service.load_analytics_context(object(), {"sales"})

    assert set(context) == {"sales_summary", "monthly_sales", "privacy_note"}
    assert len(called_queries) == 2
    assert all("product_metrics_cache" not in query for query in called_queries)


def test_load_analytics_context_keeps_churn_rows_as_a_list(monkeypatch):
    monkeypatch.setattr(
        service,
        "_records",
        lambda db, query, limit=None: [{"risk_level": "High", "customer_count": 12}],
    )

    context = service.load_analytics_context(object(), {"churn"})

    assert context["churn_distribution"] == [{"risk_level": "High", "customer_count": 12}]


def test_generate_answer_sends_only_given_aggregate_context(monkeypatch):
    captured = {}

    class FakeResponse:
        def raise_for_status(self):
            return None

        def json(self):
            return {"choices": [{"message": {"content": "Campaign A targets 12 customers."}}]}

    class FakeAsyncClient:
        def __init__(self, timeout):
            captured["timeout"] = timeout

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_):
            return None

        async def post(self, url, headers, json):
            captured.update(url=url, headers=headers, body=json)
            return FakeResponse()

    monkeypatch.setattr(service, "OPENROUTER_API_KEY", "test-key")
    monkeypatch.setattr(service, "OPENROUTER_MODEL", "test-model")
    monkeypatch.setattr(service.httpx, "AsyncClient", FakeAsyncClient)

    answer = asyncio.run(
        service.generate_answer(
            "Which campaign is largest?",
            {"active_campaigns": [{"campaign_name": "Campaign A", "customer_count": 12}]},
        )
    )

    assert answer == "Campaign A targets 12 customers."
    assert captured["url"] == service.OPENROUTER_CHAT_COMPLETIONS_URL
    assert captured["headers"] == {
        "Authorization": f"Bearer {service.OPENROUTER_API_KEY}"
    }
    assert captured["body"]["model"] == "test-model"
    assert captured["body"]["max_tokens"] == 1200
    assert "reasoning" not in captured["body"]
    submitted = json.loads(captured["body"]["messages"][1]["content"])
    assert submitted["question"] == "Which campaign is largest?"
    assert submitted["analytics"]["active_campaigns"][0]["customer_count"] == 12


def test_generate_answer_requires_provider_key(monkeypatch):
    monkeypatch.setattr(service, "OPENROUTER_API_KEY", "")

    with pytest.raises(RuntimeError, match="not configured"):
        asyncio.run(service.generate_answer("Question", {}))


def test_generate_answer_reports_openrouter_http_status(monkeypatch):
    class FakeResponse:
        def raise_for_status(self):
            raise service.httpx.HTTPStatusError(
                "Unauthorized",
                request=service.httpx.Request("POST", service.OPENROUTER_CHAT_COMPLETIONS_URL),
                response=service.httpx.Response(401),
            )

    class FakeAsyncClient:
        def __init__(self, timeout):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_):
            return None

        async def post(self, url, headers, json):
            return FakeResponse()

    monkeypatch.setattr(service, "OPENROUTER_API_KEY", "test-key")
    monkeypatch.setattr(service.httpx, "AsyncClient", FakeAsyncClient)

    with pytest.raises(ConnectionError, match="OpenRouter returned HTTP 401"):
        asyncio.run(service.generate_answer("Question", {}))


def test_generate_answer_reports_empty_visible_output(monkeypatch):
    class FakeResponse:
        def raise_for_status(self):
            return None

        def json(self):
            return {
                "choices": [
                    {
                        "message": {"content": ""},
                        "finish_reason": "length",
                    }
                ]
            }

    class FakeAsyncClient:
        def __init__(self, timeout):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_):
            return None

        async def post(self, url, headers, json):
            return FakeResponse()

    monkeypatch.setattr(service, "OPENROUTER_API_KEY", "test-key")
    monkeypatch.setattr(service.httpx, "AsyncClient", FakeAsyncClient)

    with pytest.raises(ConnectionError, match="no visible answer"):
        asyncio.run(service.generate_answer("Question", {}))


@pytest.mark.parametrize(
    ("question", "expected_title", "expected_value"),
    [
        ("Show monthly revenue trends", "Monthly revenue", 120.5),
        ("Which product category has the most sales?", "Top product categories by revenue", 120.5),
        ("How many customers are high churn risk?", "Customers by churn risk", 12),
        ("How are campaigns distributed across segments?", "Campaign reach by segment", 12),
        ("Which customer segments are largest?", "Customers by segment", 12),
        ("Which campaigns reach the most customers?", "Active campaigns by customer reach", 12),
    ],
)
def test_build_visualizations_selects_relevant_aggregate_chart(
    question,
    expected_title,
    expected_value,
):
    context = {
        "monthly_sales": [{"month": "2026-01", "revenue": 120.5}],
        "product_categories": [{"category": "books", "revenue": 120.5, "units_sold": 3}],
        "churn_distribution": [{"risk_level": "High", "customer_count": 12}],
        "campaigns_by_segment": [
            {"segment": "Loyal / Low", "campaign_name": "Retention", "customer_count": 12}
        ],
        "customer_segments": [{"segment": "Loyal / Low", "customer_count": 12}],
        "active_campaigns": [{"campaign_name": "Retention", "customer_count": 12}],
    }

    charts = service.build_visualizations(question, context)

    assert len(charts) == 1
    assert charts[0]["title"] == expected_title
    assert charts[0]["data"][0]["value"] == expected_value
