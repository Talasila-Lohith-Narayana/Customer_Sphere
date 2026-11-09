import asyncio
import json

import pytest
from pydantic import ValidationError

from app.api.assistant import service
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

    monkeypatch.setattr(service, "OPENAI_API_KEY", "test-key")
    monkeypatch.setattr(service, "OPENAI_MODEL", "test-model")
    monkeypatch.setattr(service.httpx, "AsyncClient", FakeAsyncClient)

    answer = asyncio.run(
        service.generate_answer(
            "Which campaign is largest?",
            {"active_campaigns": [{"campaign_name": "Campaign A", "customer_count": 12}]},
        )
    )

    assert answer == "Campaign A targets 12 customers."
    assert captured["url"] == service.OPENAI_CHAT_COMPLETIONS_URL
    assert captured["headers"] == {"Authorization": "Bearer test-key"}
    assert captured["body"]["model"] == "test-model"
    submitted = json.loads(captured["body"]["messages"][1]["content"])
    assert submitted["question"] == "Which campaign is largest?"
    assert submitted["analytics"]["active_campaigns"][0]["customer_count"] == 12


def test_generate_answer_requires_provider_key(monkeypatch):
    monkeypatch.setattr(service, "OPENAI_API_KEY", "")

    with pytest.raises(RuntimeError, match="not configured"):
        asyncio.run(service.generate_answer("Question", {}))
