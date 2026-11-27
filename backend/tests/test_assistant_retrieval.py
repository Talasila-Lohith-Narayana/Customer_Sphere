from types import SimpleNamespace

import pytest

from app.api.assistant import retrieval


def test_chunk_text_splits_content_with_overlap_and_reassembles_words():
    chunks = retrieval.chunk_text("alpha beta gamma delta epsilon", chunk_size=15, overlap=5)

    assert len(chunks) > 1
    assert chunks[0].split()[0] == "alpha"
    assert chunks[-1].split()[-1] == "epsilon"
    assert all(len(chunk) <= 15 for chunk in chunks)
    assert any(
        set(left.split()) & set(right.split())
        for left, right in zip(chunks, chunks[1:])
    )


@pytest.mark.parametrize(
    ("question", "user", "expected"),
    [
        (
            "What did we discuss on the last customer call?",
            {"role": "viewer", "access_pages": ["assistant", "customers"]},
            ["interaction"],
        ),
        (
            "Find product details in the catalog",
            {"role": "viewer", "access_pages": ["assistant"]},
            [],
        ),
        (
            "Tell me about customer customer-123",
            {"role": "viewer", "access_pages": ["assistant", "customers"]},
            [],
        ),
        (
            "Explain the product catalog setup",
            {"role": "viewer", "access_pages": ["assistant"]},
            ["document"],
        ),
        (
            "What is Customer Sphere?",
            {"role": "viewer", "access_pages": ["assistant"]},
            ["document"],
        ),
        (
            "Which products have the most revenue?",
            {"role": "admin", "access_pages": []},
            ["product"],
        ),
    ],
)
def test_retrieval_source_selection_obeys_question_and_access(
    question,
    user,
    expected,
):
    assert retrieval.allowed_sources_for_question(question, user) == expected


def test_search_knowledge_filters_to_allowed_sources_and_customer(monkeypatch):
    captured = {}

    class FakeClient:
        def collection_exists(self, collection_name):
            return True

        def query_points(self, **kwargs):
            captured.update(kwargs)
            return SimpleNamespace(
                points=[
                    SimpleNamespace(
                        payload={
                            "source_type": "interaction",
                            "title": "Shipping call",
                            "text": "Customer asked about shipping.",
                            "customer_id": "customer-123",
                        },
                        score=0.91,
                    )
                ]
            )

    monkeypatch.setattr(retrieval, "VECTOR_SEARCH_ENABLED", True)
    monkeypatch.setattr(retrieval, "_get_client", lambda: FakeClient())
    monkeypatch.setattr(retrieval, "_embed_texts", lambda texts: [[0.1] * 384])

    result = retrieval.search_knowledge(
        "What did we discuss about shipping?",
        ["interaction"],
        customer_id="customer-123",
    )

    assert result[0]["customer_id"] == "customer-123"
    conditions = captured["query_filter"].must
    assert conditions[0].key == "source_type"
    assert conditions[0].match.any == ["interaction"]
    assert conditions[1].key == "customer_id"
    assert conditions[1].match.value == "customer-123"


def test_search_is_disabled_without_vector_feature(monkeypatch):
    monkeypatch.setattr(retrieval, "VECTOR_SEARCH_ENABLED", False)
    assert retrieval.search_knowledge("product details", ["product"]) == []


def test_interaction_notes_are_formatted_locally_with_source_details():
    answer = retrieval.format_interaction_results(
        [
            {
                "customer_id": "customer-123",
                "interaction_type": "call",
                "source": "Delivery follow-up",
                "created_at": "2026-11-20T09:30:00",
                "text": "Customer asked about a delayed order.",
            }
        ]
    )

    assert "customer-123" in answer
    assert "Delivery follow-up (call, 2026-11-20)" in answer
    assert "delayed order" in answer
    assert retrieval.format_interaction_results([]) == (
        "I couldn't find any matching indexed interaction notes."
    )


def test_external_llm_history_excludes_interaction_note_turns():
    turns = [
        {"question": "How much revenue did we make?", "answer": "R$100."},
        {
            "question": "What did we discuss on the customer's call?",
            "answer": "They asked about delivery.",
        },
    ]

    assert retrieval.external_history(turns) == turns[:1]
