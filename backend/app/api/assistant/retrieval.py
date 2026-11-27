import hashlib
import logging
import os
import re
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any, Iterable

from qdrant_client import QdrantClient, models
from sqlalchemy import text

logger = logging.getLogger(__name__)

QDRANT_URL = os.getenv("QDRANT_URL", "http://localhost:6333")
QDRANT_COLLECTION = os.getenv("QDRANT_COLLECTION", "customer_sphere_knowledge")
VECTOR_SEARCH_ENABLED = os.getenv("VECTOR_SEARCH_ENABLED", "false").strip().lower() in {
    "1",
    "true",
    "yes",
}
EMBEDDING_MODEL = os.getenv(
    "LOCAL_EMBEDDING_MODEL",
    "BAAI/bge-small-en-v1.5",
)
KNOWLEDGE_DIRECTORY = Path(
    os.getenv(
        "KNOWLEDGE_DIRECTORY",
        str(Path(__file__).resolve().parents[3] / "knowledge"),
    )
).resolve()
VECTOR_SIZE = 384
CHUNK_SIZE = 1000
CHUNK_OVERLAP = 150
SEARCH_LIMIT = 5
_INTERACTION_TERMS = re.compile(
    r"\b(?:interactions?|notes?|calls?|emails?|support|contacts?|feedback|complaints?|"
    r"discuss|discussed|told|say|said|mentioned|conversation)\b|"
    r"\btell\s+(?:the\s+)?customers?\b|\bwhat did we tell\b",
    re.I,
)
_PRODUCT_TERMS = re.compile(
    r"\b(?:product|products|catalog|category|categories|weight|photos?)\b",
    re.I,
)
_DOCUMENT_TERMS = re.compile(
    r"\b(?:documentation|docs|policy|policies|faq|how does|how do i|how to|"
    r"what does|what is|what are|explain|setup|configure|configuration)\b",
    re.I,
)
_client: QdrantClient | None = None
_embedding_model: Any | None = None


def chunk_text(
    text: str,
    *,
    chunk_size: int = CHUNK_SIZE,
    overlap: int = CHUNK_OVERLAP,
) -> list[str]:
    if chunk_size < 1 or overlap < 0 or overlap >= chunk_size:
        raise ValueError("Chunk size must be positive and overlap smaller than size.")

    normalized = " ".join(text.split())
    if not normalized:
        return []

    chunks = []
    start = 0
    while start < len(normalized):
        end = min(start + chunk_size, len(normalized))
        if end < len(normalized):
            boundary = normalized.rfind(" ", start + chunk_size // 2, end)
            if boundary > start:
                end = boundary
        chunk = normalized[start:end].strip()
        if chunk:
            chunks.append(chunk)
        if end >= len(normalized):
            break
        start = max(start + 1, end - overlap)
    return chunks


def _point_id(source_type: str, source_id: str, chunk_index: int) -> str:
    value = f"{source_type}:{source_id}:{chunk_index}"
    return str(uuid.uuid5(uuid.NAMESPACE_URL, value))


def _get_client() -> QdrantClient:
    global _client
    if _client is None:
        _client = QdrantClient(url=QDRANT_URL, timeout=5)
    return _client


def _embed_texts(texts: list[str]) -> list[list[float]]:
    global _embedding_model
    if _embedding_model is None:
        from fastembed import TextEmbedding

        _embedding_model = TextEmbedding(model_name=EMBEDDING_MODEL)
    return [vector.tolist() for vector in _embedding_model.embed(texts)]


def _ensure_collection(client: QdrantClient) -> None:
    if client.collection_exists(QDRANT_COLLECTION):
        return
    client.create_collection(
        collection_name=QDRANT_COLLECTION,
        vectors_config=models.VectorParams(
            size=VECTOR_SIZE,
            distance=models.Distance.COSINE,
        ),
    )


def _delete_source(source_type: str, source_id: str) -> None:
    client = _get_client()
    if not client.collection_exists(QDRANT_COLLECTION):
        return
    client.delete(
        collection_name=QDRANT_COLLECTION,
        points_selector=models.FilterSelector(
            filter=models.Filter(
                must=[
                    models.FieldCondition(
                        key="source_type",
                        match=models.MatchValue(value=source_type),
                    ),
                    models.FieldCondition(
                        key="source_id",
                        match=models.MatchValue(value=source_id),
                    ),
                ]
            )
        ),
        wait=True,
    )


def _upsert_chunks(
    source_type: str,
    source_id: str,
    title: str,
    content: str,
    metadata: dict[str, Any] | None = None,
) -> int:
    if not chunk_text(content):
        _delete_source(source_type, source_id)
        return 0

    _delete_source(source_type, source_id)
    return _upsert_batch(
        [
            {
                "source_type": source_type,
                "source_id": source_id,
                "title": title,
                "content": content,
                "metadata": metadata or {},
            }
        ]
    )


def _upsert_batch(entries: list[dict[str, Any]]) -> int:
    flattened = []
    for entry in entries:
        for chunk_index, chunk in enumerate(chunk_text(entry["content"])):
            flattened.append(
                {
                    "id": _point_id(
                        entry["source_type"],
                        entry["source_id"],
                        chunk_index,
                    ),
                    "source_type": entry["source_type"],
                    "source_id": entry["source_id"],
                    "title": entry["title"],
                    "text": chunk,
                    **entry.get("metadata", {}),
                }
            )
    if not flattened:
        return 0

    client = _get_client()
    _ensure_collection(client)
    vectors = _embed_texts([item["text"] for item in flattened])
    points = [
        models.PointStruct(
            id=item["id"],
            vector=vector,
            payload={key: value for key, value in item.items() if key != "id"},
        )
        for item, vector in zip(flattened, vectors)
    ]
    client.upsert(
        collection_name=QDRANT_COLLECTION,
        points=points,
        wait=True,
    )
    return len(points)


def index_interaction(
    interaction_id: int,
    customer_id: str,
    interaction_type: str,
    title: str,
    description: str,
    created_at: datetime | str | None = None,
) -> int:
    if not VECTOR_SEARCH_ENABLED:
        return 0
    source_id = str(interaction_id)
    content = (
        f"Customer interaction. Type: {interaction_type}. "
        f"Title: {title}. Details: {description}"
    )
    return _upsert_chunks(
        "interaction",
        source_id,
        title,
        content,
        {
            "customer_id": customer_id,
            "interaction_type": interaction_type,
            "created_at": (
                created_at.isoformat()
                if isinstance(created_at, datetime)
                else created_at
            ),
        },
    )


def delete_interaction(interaction_id: int) -> None:
    if not VECTOR_SEARCH_ENABLED:
        return
    _delete_source("interaction", str(interaction_id))


def delete_customer_interactions(customer_id: str) -> None:
    if not VECTOR_SEARCH_ENABLED:
        return
    client = _get_client()
    if not client.collection_exists(QDRANT_COLLECTION):
        return
    client.delete(
        collection_name=QDRANT_COLLECTION,
        points_selector=models.FilterSelector(
            filter=models.Filter(
                must=[
                    models.FieldCondition(
                        key="source_type",
                        match=models.MatchValue(value="interaction"),
                    ),
                    models.FieldCondition(
                        key="customer_id",
                        match=models.MatchValue(value=customer_id),
                    ),
                ]
            )
        ),
        wait=True,
    )


def sync_customer_interactions(db, customer_id: str) -> None:
    if not VECTOR_SEARCH_ENABLED:
        return
    delete_customer_interactions(customer_id)
    from app.models import ConsumerInteraction

    interactions = (
        db.query(ConsumerInteraction)
        .filter(ConsumerInteraction.customer_id == customer_id)
        .all()
    )
    for interaction in interactions:
        index_interaction(
            interaction.id,
            customer_id,
            interaction.interaction_type,
            interaction.title,
            interaction.description,
            interaction.created_at,
        )


def search_knowledge(
    query: str,
    allowed_sources: Iterable[str],
    limit: int = SEARCH_LIMIT,
    customer_id: str | None = None,
) -> list[dict[str, Any]]:
    if not VECTOR_SEARCH_ENABLED:
        return []
    source_types = sorted(set(allowed_sources))
    if not source_types:
        return []
    client = _get_client()
    if not client.collection_exists(QDRANT_COLLECTION):
        return []

    conditions = [
        models.FieldCondition(
            key="source_type",
            match=models.MatchAny(any=source_types),
        )
    ]
    if customer_id is not None:
        conditions.append(
            models.FieldCondition(
                key="customer_id",
                match=models.MatchValue(value=customer_id),
            )
        )
    response = client.query_points(
        collection_name=QDRANT_COLLECTION,
        query=_embed_texts([query])[0],
        query_filter=models.Filter(must=conditions),
        limit=limit,
        with_payload=True,
    )
    results = []
    for point in response.points:
        payload = point.payload or {}
        results.append(
            {
                "source_type": payload.get("source_type"),
                "source": payload.get("title"),
                "text": payload.get("text"),
                "customer_id": payload.get("customer_id"),
                "interaction_type": payload.get("interaction_type"),
                "created_at": payload.get("created_at"),
                "score": float(point.score),
            }
        )
    return results


def allowed_sources_for_question(
    question: str,
    current_user: dict[str, Any],
) -> list[str]:
    sources = []
    if _DOCUMENT_TERMS.search(question):
        sources.append("document")
    if (
        _PRODUCT_TERMS.search(question)
        and (
            current_user.get("role") == "admin"
            or "products" in current_user.get("access_pages", [])
        )
    ):
        sources.append("product")
    if (
        _INTERACTION_TERMS.search(question)
        and (
            current_user.get("role") == "admin"
            or "customers" in current_user.get("access_pages", [])
        )
    ):
        sources.append("interaction")
    return sources


def contains_interaction_terms(question: str) -> bool:
    return bool(_INTERACTION_TERMS.search(question))


def external_history(history: list[dict[str, str]]) -> list[dict[str, str]]:
    return [
        turn
        for turn in history
        if not contains_interaction_terms(turn.get("question", ""))
    ]


def format_interaction_results(results: list[dict[str, Any]]) -> str:
    if not results:
        return "I couldn't find any matching indexed interaction notes."

    formatted = []
    for result in results[:3]:
        customer_id = result.get("customer_id", "unknown customer")
        interaction_type = result.get("interaction_type", "interaction")
        title = result.get("source") or "Untitled interaction"
        created_at = result.get("created_at")
        date_label = f", {created_at[:10]}" if isinstance(created_at, str) else ""
        content = result.get("text") or ""
        formatted.append(
            f"- Customer {customer_id} - {title} ({interaction_type}{date_label}): "
            f"{content[:600]}"
        )
    return "Matching customer interaction notes:\n" + "\n".join(formatted)


def _index_document(path: Path) -> int:
    content = path.read_text(encoding="utf-8")
    relative_path = str(path.relative_to(KNOWLEDGE_DIRECTORY))
    digest = hashlib.sha256(content.encode("utf-8")).hexdigest()
    return _upsert_chunks(
        "document",
        f"{relative_path}:{digest}",
        path.stem.replace("_", " "),
        content,
        {"path": relative_path},
    )


def _documents() -> list[Path]:
    if not KNOWLEDGE_DIRECTORY.is_dir():
        return []
    return sorted(KNOWLEDGE_DIRECTORY.rglob("*.md"))


def reindex_knowledge(db) -> dict[str, int]:
    if not VECTOR_SEARCH_ENABLED:
        raise RuntimeError("Enable VECTOR_SEARCH_ENABLED before building the index.")
    client = _get_client()
    if client.collection_exists(QDRANT_COLLECTION):
        client.delete_collection(QDRANT_COLLECTION)
    _ensure_collection(client)

    counts = {"documents": 0, "products": 0, "interactions": 0}
    for path in _documents():
        counts["documents"] += _index_document(path)

    products = db.execute(text(
        """
        SELECT product_id,
               COALESCE(product_category_name, 'uncategorized') AS category,
               COALESCE(product_name_lenght, 0) AS name_length,
               COALESCE(product_description_lenght, 0) AS description_length,
               COALESCE(product_photos_qty, 0) AS photo_count,
               COALESCE(product_weight_g, 0) AS weight_g
        FROM products
        """
    )).mappings()
    product_batch = []
    for product in products:
        product_id = str(product["product_id"])
        category = str(product["category"])
        content = (
            f"Product {product_id}. Category: {category.replace('_', ' ')}. "
            f"Product name length: {product['name_length']}. "
            f"Description length: {product['description_length']}. "
            f"Photos: {product['photo_count']}. Weight: {product['weight_g']} grams."
        )
        product_batch.append(
            {
                "source_type": "product",
                "source_id": product_id,
                "title": f"{category.replace('_', ' ').title()} product",
                "content": content,
                "metadata": {"product_id": product_id, "category": category},
            }
        )
        if len(product_batch) >= 64:
            counts["products"] += _upsert_batch(product_batch)
            product_batch = []
    if product_batch:
        counts["products"] += _upsert_batch(product_batch)

    interaction_batch = []
    interaction_rows = db.execute(
        text(
            """
            SELECT ci.id, c.customer_unique_id AS customer_id,
                   ci.interaction_type, ci.title, ci.description, ci.created_at
            FROM consumer_interactions ci
            JOIN customers c
              ON c.customer_unique_id = ci.customer_id
              OR c.customer_id = ci.customer_id
            """
        )
    ).mappings()
    for interaction in interaction_rows:
        interaction_batch.append(
            {
                "source_type": "interaction",
                "source_id": str(interaction.id),
                "title": interaction.title,
                "content": (
                    f"Customer interaction. Type: {interaction.interaction_type}. "
                    f"Title: {interaction.title}. Details: {interaction.description}"
                ),
                "metadata": {
                    "customer_id": interaction.customer_id,
                    "interaction_type": interaction.interaction_type,
                    "created_at": (
                        interaction.created_at.isoformat()
                        if isinstance(interaction.created_at, datetime)
                        else str(interaction.created_at)
                    ),
                },
            }
        )
        if len(interaction_batch) >= 64:
            counts["interactions"] += _upsert_batch(interaction_batch)
            interaction_batch = []
    if interaction_batch:
        counts["interactions"] += _upsert_batch(interaction_batch)
    logger.info("Reindexed local vector knowledge: %s", counts)
    return counts
