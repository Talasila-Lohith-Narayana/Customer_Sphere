import logging
import re

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.exc import SQLAlchemyError
from starlette.concurrency import run_in_threadpool
from sqlalchemy.orm import Session

from app.api.assistant import service
from app.api.assistant.schemas import (
    AssistantAnswer,
    AssistantChatSession,
    AssistantChatSessions,
    AssistantChatSessionUpdate,
    AssistantHistory,
    AssistantQuestion,
    AssistantStatus,
)
from app.core.database import get_db
from app.core.permissions import require_page

logger = logging.getLogger(__name__)
router = APIRouter(tags=["Analytics assistant"])


@router.get("/status", response_model=AssistantStatus)
def assistant_status(_: dict = Depends(require_page("assistant"))):
    return AssistantStatus(
        configured=service.is_configured(),
        model=service.OPENROUTER_MODEL,
    )


@router.get("/sessions", response_model=AssistantChatSessions)
def assistant_sessions(
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_page("assistant")),
):
    try:
        sessions = service.list_chat_sessions(db, current_user["user_id"])
    except SQLAlchemyError as exc:
        logger.exception("Could not load assistant chat sessions.")
        raise HTTPException(
            status_code=503,
            detail="Assistant conversations are temporarily unavailable.",
        ) from exc
    return AssistantChatSessions(sessions=sessions)


@router.post("/sessions", response_model=AssistantChatSession, status_code=201)
def create_assistant_session(
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_page("assistant")),
):
    try:
        return service.create_chat_session(db, current_user["user_id"])
    except SQLAlchemyError as exc:
        db.rollback()
        logger.exception("Could not create assistant chat session.")
        raise HTTPException(
            status_code=503,
            detail="A new conversation could not be created.",
        ) from exc


@router.patch("/sessions/{session_id}", response_model=AssistantChatSession)
def rename_assistant_session(
    session_id: int,
    payload: AssistantChatSessionUpdate,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_page("assistant")),
):
    try:
        session = service.rename_chat_session(
            db,
            current_user["user_id"],
            session_id,
            payload.title,
        )
    except SQLAlchemyError as exc:
        db.rollback()
        logger.exception("Could not rename assistant conversation.")
        raise HTTPException(
            status_code=503,
            detail="Assistant conversation could not be renamed.",
        ) from exc
    if session is None:
        raise HTTPException(status_code=404, detail="Conversation not found.")
    return session


@router.get("/sessions/{session_id}/history", response_model=AssistantHistory)
def assistant_session_history(
    session_id: int,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_page("assistant")),
):
    session = service.get_chat_session(db, current_user["user_id"], session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Conversation not found.")
    try:
        turns = service.load_chat_turns(db, current_user["user_id"], session_id)
    except SQLAlchemyError as exc:
        logger.exception("Could not load assistant conversation.")
        raise HTTPException(
            status_code=503,
            detail="Assistant conversation is temporarily unavailable.",
        ) from exc
    return AssistantHistory(turns=turns)


@router.delete("/sessions/{session_id}", status_code=204)
def delete_assistant_session(
    session_id: int,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_page("assistant")),
):
    try:
        deleted = service.delete_chat_session(
            db,
            current_user["user_id"],
            session_id,
        )
    except SQLAlchemyError as exc:
        db.rollback()
        logger.exception("Could not delete assistant conversation.")
        raise HTTPException(
            status_code=503,
            detail="Assistant conversation could not be deleted.",
        ) from exc
    if not deleted:
        raise HTTPException(status_code=404, detail="Conversation not found.")


@router.post("/ask", response_model=AssistantAnswer)
async def ask_assistant(
    payload: AssistantQuestion,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_page("assistant")),
):
    session = service.get_chat_session(
        db,
        current_user["user_id"],
        payload.session_id,
    )
    if session is None:
        raise HTTPException(status_code=404, detail="Conversation not found.")

    domains = service.select_analytics_domains(payload.question)
    customer_match = re.search(r"\b[a-fA-F0-9]{32}\b", payload.question)
    customer_id = customer_match.group(0) if customer_match else None
    if (
        customer_id
        and current_user["role"] != "admin"
        and "customers" not in current_user["access_pages"]
    ):
        raise HTTPException(
            status_code=403,
            detail="Access to customer records is not permitted.",
        )

    if not service.is_configured():
        raise HTTPException(
            status_code=503,
            detail=(
                "The analytics assistant is not configured. "
                "Set OPENROUTER_API_KEY on the backend."
            ),
        )

    try:
        history = await run_in_threadpool(
            service.load_chat_turns,
            db,
            current_user["user_id"],
            payload.session_id,
            20,
        )
    except SQLAlchemyError as exc:
        logger.exception("Could not load assistant conversation context.")
        raise HTTPException(
            status_code=503,
            detail="Assistant chat history is temporarily unavailable.",
        ) from exc

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
        analytics_context = {}

    if customer_id:
        try:
            customer_context = await run_in_threadpool(
                service.load_customer_context,
                db,
                customer_id,
                current_user,
            )
        except HTTPException:
            raise
        except SQLAlchemyError as exc:
            logger.exception("Could not load customer context for Nova.")
            raise HTTPException(
                status_code=503,
                detail="Customer information is temporarily unavailable.",
            ) from exc
        analytics_context["customer"] = customer_context

    try:
        answer = await service.generate_answer(
            payload.question,
            analytics_context,
            [{"question": turn["question"], "answer": turn["answer"]} for turn in history],
        )
    except TimeoutError as exc:
        raise HTTPException(status_code=504, detail=str(exc)) from exc
    except ConnectionError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    visualizations = service.build_visualizations(payload.question, analytics_context)
    try:
        await run_in_threadpool(
            service.save_chat_turn,
            db,
            current_user["user_id"],
            payload.session_id,
            payload.question,
            answer,
            visualizations,
        )
    except LookupError as exc:
        db.rollback()
        raise HTTPException(status_code=404, detail="Conversation not found.") from exc
    except SQLAlchemyError as exc:
        db.rollback()
        logger.exception("Could not save assistant chat turn.")
        raise HTTPException(
            status_code=503,
            detail="The answer was generated but could not be saved to chat history.",
        ) from exc

    return AssistantAnswer(answer=answer, visualizations=visualizations)
