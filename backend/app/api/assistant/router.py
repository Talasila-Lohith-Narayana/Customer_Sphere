import logging

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.exc import SQLAlchemyError
from starlette.concurrency import run_in_threadpool
from sqlalchemy.orm import Session

from app.api.assistant import service
from app.api.assistant.schemas import AssistantAnswer, AssistantQuestion, AssistantStatus
from app.core.database import get_db
from app.core.permissions import require_page

logger = logging.getLogger(__name__)
router = APIRouter(tags=["Analytics assistant"])


@router.get("/status", response_model=AssistantStatus)
def assistant_status(_: dict = Depends(require_page("analytics"))):
    return AssistantStatus(
        configured=service.is_configured(),
        model=service.OPENROUTER_MODEL,
    )


@router.post("/ask", response_model=AssistantAnswer)
async def ask_assistant(
    payload: AssistantQuestion,
    db: Session = Depends(get_db),
    _: dict = Depends(require_page("analytics")),
):
    domains = service.select_analytics_domains(payload.question)

    if not service.is_configured():
        raise HTTPException(
            status_code=503,
            detail=(
                "The analytics assistant is not configured. "
                "Set OPENROUTER_API_KEY on the backend."
            ),
        )

    if domains:
        try:
            analytics_context = await run_in_threadpool(
                service.load_analytics_context,
                db,
                domains,
            )
        except SQLAlchemyError as exc:
            logger.exception("Could not load aggregate data for the analytics assistant.")
            raise HTTPException(
                status_code=503,
                detail="Analytics data is temporarily unavailable.",
            ) from exc
    else:
        analytics_context = {
            "privacy_note": (
                "No analytics data is relevant to this request. Do not invent "
                "business metrics or claim to have accessed customer data."
            )
        }

    try:
        answer = await service.generate_answer(payload.question, analytics_context)
    except TimeoutError as exc:
        raise HTTPException(status_code=504, detail=str(exc)) from exc
    except ConnectionError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    return AssistantAnswer(
        answer=answer,
        visualizations=service.build_visualizations(payload.question, analytics_context),
    )
