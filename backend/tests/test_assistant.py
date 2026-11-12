import asyncio
import json

import pytest
from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.api.assistant import router, service
from app.api.assistant.schemas import AssistantChatSessionUpdate, AssistantQuestion
from app.models import AppUser, AssistantChatSession, AssistantChatTurn


@pytest.mark.parametrize("question", ["", "   ", "\t\n"])
def test_assistant_rejects_blank_questions(question):
    with pytest.raises(ValidationError):
        AssistantQuestion(question=question, session_id=1)


def test_assistant_limits_question_length():
    with pytest.raises(ValidationError):
        AssistantQuestion(question="x" * 1001, session_id=1)


def test_assistant_trims_question():
    assert AssistantQuestion(
        question="  campaign summary  ",
        session_id=1,
    ).question == "campaign summary"


def test_assistant_trims_chat_session_title():
    assert AssistantChatSessionUpdate(title="  Monthly revenue  ").title == (
        "Monthly revenue"
    )
    with pytest.raises(ValidationError):
        AssistantChatSessionUpdate(title="   ")


def test_rename_chat_session_updates_only_the_owner_session():
    engine = create_engine("sqlite://")
    AppUser.__table__.create(engine)
    AssistantChatSession.__table__.create(engine)
    try:
        with Session(engine) as db:
            first_user = AppUser(
                username="first", password_hash="hash", role="viewer"
            )
            second_user = AppUser(
                username="second", password_hash="hash", role="viewer"
            )
            db.add_all([first_user, second_user])
            db.commit()
            first_session = service.create_chat_session(db, first_user.id)
            second_session = service.create_chat_session(db, second_user.id)

            renamed = service.rename_chat_session(
                db,
                first_user.id,
                first_session["id"],
                "Monthly revenue",
            )

            assert renamed["title"] == "Monthly revenue"
            assert service.get_chat_session(
                db,
                second_user.id,
                second_session["id"],
            ).title == "New chat"
            assert service.rename_chat_session(
                db,
                first_user.id,
                second_session["id"],
                "Not yours",
            ) is None
    finally:
        engine.dispose()


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
    history_limits = []

    def load_history(db, user_id, session_id, limit=100):
        history_limits.append(limit)
        return []

    monkeypatch.setattr(service, "get_chat_session", lambda *args: object())
    monkeypatch.setattr(service, "load_chat_turns", load_history)
    monkeypatch.setattr(service, "save_chat_turn", lambda *args: None)

    def fail_if_called(*args, **kwargs):
        raise AssertionError("unmatched questions must not load analytics")

    async def answer_without_analytics(received_question, context, history):
        assert received_question == question
        assert context == {}
        assert history == []
        return "Model-generated response."

    monkeypatch.setattr(service, "load_analytics_context", fail_if_called)
    monkeypatch.setattr(service, "generate_answer", answer_without_analytics)

    answer = asyncio.run(
        router.ask_assistant(
            AssistantQuestion(question=question, session_id=1),
            db=None,
            current_user={"user_id": 1},
        )
    )

    assert answer.answer == "Model-generated response."
    assert answer.visualizations == []
    assert history_limits == [20]


def test_customer_question_requires_customer_page_access(monkeypatch):
    monkeypatch.setattr(service, "get_chat_session", lambda *args: object())

    with pytest.raises(HTTPException) as error:
        asyncio.run(
            router.ask_assistant(
                AssistantQuestion(
                    question="Tell me about customer 0123456789abcdef0123456789abcdef",
                    session_id=1,
                ),
                db=None,
                current_user={
                    "user_id": 1,
                    "role": "viewer",
                    "access_pages": ["assistant"],
                },
            )
        )

    assert error.value.status_code == 403


def test_chat_history_is_persisted_and_isolated_by_user():
    engine = create_engine("sqlite://")
    AppUser.__table__.create(engine)
    AssistantChatSession.__table__.create(engine)
    AssistantChatTurn.__table__.create(engine)
    try:
        with Session(engine) as db:
            first_user = AppUser(
                username="first", password_hash="hash", role="viewer"
            )
            second_user = AppUser(
                username="second", password_hash="hash", role="viewer"
            )
            db.add_all([first_user, second_user])
            db.commit()

            first_session = service.create_chat_session(db, first_user.id)
            second_session = service.create_chat_session(db, second_user.id)
            service.save_chat_turn(
                db,
                first_user.id,
                first_session["id"],
                "How are sales?",
                "Sales increased.",
                [{"title": "Monthly revenue", "data": [], "format": "currency"}],
            )
            service.save_chat_turn(
                db,
                second_user.id,
                second_session["id"],
                "How is churn?",
                "Churn risk is low.",
                [],
            )

            assert service.load_chat_turns(db, first_user.id, first_session["id"]) == [
                {
                    "question": "How are sales?",
                    "answer": "Sales increased.",
                    "visualizations": [
                        {"title": "Monthly revenue", "data": [], "format": "currency"}
                    ],
                }
            ]
            assert service.load_chat_turns(db, first_user.id, second_session["id"]) == []
            assert service.delete_chat_session(db, first_user.id, first_session["id"])
            assert service.load_chat_turns(db, first_user.id, first_session["id"]) == []
            assert service.load_chat_turns(db, second_user.id, second_session["id"])[0]["question"] == (
                "How is churn?"
            )
    finally:
        engine.dispose()


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
            [{"question": "What is Campaign A?", "answer": "A retention campaign."}],
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
    system_prompt = captured["body"]["messages"][0]["content"]
    assert "You are Nova" in system_prompt
    assert "whenever asked your name or identity, say that you are Nova" in system_prompt
    assert "general-knowledge questions normally" in system_prompt
    assert "never invent metrics" in system_prompt
    assert "use it naturally when relevant in later turns" in system_prompt
    assert "Do not say you refuse to remember such details" in system_prompt
    assert captured["body"]["messages"][1:] == [
        {"role": "user", "content": "What is Campaign A?"},
        {"role": "assistant", "content": "A retention campaign."},
        {
            "role": "user",
            "content": json.dumps(
                {
                    "question": "Which campaign is largest?",
                    "analytics": {
                        "active_campaigns": [
                            {"campaign_name": "Campaign A", "customer_count": 12}
                        ]
                    },
                },
                ensure_ascii=True,
                separators=(",", ":"),
            ),
        },
    ]
    submitted = json.loads(captured["body"]["messages"][-1]["content"])
    assert submitted["question"] == "Which campaign is largest?"
    assert submitted["analytics"]["active_campaigns"][0]["customer_count"] == 12


def test_generate_answer_requires_provider_key(monkeypatch):
    monkeypatch.setattr(service, "OPENROUTER_API_KEY", "")

    with pytest.raises(RuntimeError, match="not configured"):
        asyncio.run(service.generate_answer("Question", {}))


@pytest.mark.parametrize(
    ("status_code", "message_fragment"),
    [
        (401, "Check the OPENROUTER_API_KEY"),
        (402, "insufficient credits or has reached a spending limit"),
        (403, "selected model is available"),
        (404, "OPENROUTER_MODEL"),
        (429, "free-model daily quota may be used up"),
        (503, "temporarily unavailable"),
    ],
)
def test_generate_answer_explains_openrouter_errors(
    monkeypatch,
    status_code,
    message_fragment,
):
    class FakeResponse:
        def raise_for_status(self):
            raise service.httpx.HTTPStatusError(
                "Provider error",
                request=service.httpx.Request("POST", service.OPENROUTER_CHAT_COMPLETIONS_URL),
                response=service.httpx.Response(
                    status_code,
                    json={
                        "error": {
                            "message": "provider details that should not be shown",
                            "metadata": {"provider_code": "TEST_PROVIDER_CODE"},
                        }
                    },
                ),
            )

        def json(self):
            return {
                "error": {
                    "message": "provider details that should not be shown",
                    "metadata": {"provider_code": "TEST_PROVIDER_CODE"},
                }
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

    with pytest.raises(ConnectionError, match=message_fragment) as error:
        asyncio.run(service.generate_answer("Question", {}))
    assert "provider details that should not be shown" not in str(error.value)


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
