import json

from app.core.database import SessionLocal
from app.api.assistant.retrieval import reindex_knowledge


def main() -> None:
    with SessionLocal() as db:
        counts = reindex_knowledge(db)
    print(json.dumps(counts, sort_keys=True))


if __name__ == "__main__":
    main()
