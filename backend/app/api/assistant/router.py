import json
import logging
import re
import secrets
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import ValidationError
from sqlalchemy import text, update
from sqlalchemy.exc import SQLAlchemyError
from starlette.concurrency import run_in_threadpool
from sqlalchemy.orm import Session

from app.api.assistant import service
from app.api.assistant.schemas import (
    AssistantActionPending,
    AssistantActionProposal,
    AssistantActionResult,
    AssistantAnswer,
    AssistantChatSession,
    AssistantChatSessions,
    AssistantChatSessionUpdate,
    AssistantHistory,
    AssistantQuestion,
    AssistantStatus,
    CreateCustomerAction,
    DeleteCustomerAction,
    DeleteOrdersAction,
    LogInteractionAction,
    UpdateCustomerAction,
)
from app.core.database import get_db
from app.core.permissions import require_page
from app.models import AssistantPendingAction
from app.schemas import CustomerIn

logger = logging.getLogger(__name__)
router = APIRouter(tags=["Analytics assistant"])
ACTION_CONFIRMATION_TTL = timedelta(minutes=10)


def _is_explicit_action_confirmation(question: str) -> bool:
    normalized = re.sub(r"[.!?,]+", " ", question.strip().casefold())
    normalized = re.sub(r"\s+", " ", normalized).strip()
    if not normalized or "?" in question or re.search(
        r"\b(?:don't|do not|not|never|cancel|stop)\b", normalized
    ):
        return False
    affirmation = re.match(
        r"^(?:yes|yeah|yep|sure|okay|ok|alright|confirmed|approved)\b\s*",
        normalized,
    )
    if affirmation:
        normalized = normalized[affirmation.end():].strip()
        if not normalized:
            return True

    return bool(
        re.fullmatch(
            r"(?:please\s+)?(?:go ahead(?:\s+and)?|proceed|continue|execute|confirm)"
            r"(?:\s+(?:with|to))?"
            r"(?:\s+(?:the\s+)?(?:delet\w*|remov\w*|action|orders?|customers?|them|those|it))*",
            normalized,
        )
        or re.fullmatch(
            r"(?:please\s+)?(?:delet\w*|remov\w*)\s+"
            r"(?:(?:the|those|these|selected|listed|specified|requested)\s+)?"
            r"(?:orders?|customers?|them|those|it)",
            normalized,
        )
        or re.fullmatch(
            r"(?:i|we)\s+(?:want|would like|agree|approve|confirm)"
            r"(?:\s+you\s+to)?\s+"
            r"(?:proceed|delet\w*|remov\w*|execute|do it)"
            r"(?:\s+(?:with\s+)?(?:the\s+)?"
            r"(?:delet\w*|remov\w*|orders?|customers?|them|those|it))?",
            normalized,
        )
    )


def _pending_action_for_latest_turn(
    db: Session,
    user_id: int,
    history: list[dict[str, str]],
) -> tuple[bool, str | None]:
    if not history:
        return False, None
    latest_answer = history[-1]["answer"]
    if (
        "confirm below to proceed" not in latest_answer.casefold()
        or "nothing has been saved yet" not in latest_answer.casefold()
    ):
        return False, None

    pending_actions = (
        db.query(AssistantPendingAction)
        .filter_by(user_id=user_id, status="pending")
        .all()
    )
    matching_actions = [
        action
        for action in pending_actions
        if action.summary and action.summary in latest_answer
    ]
    if len(matching_actions) == 1:
        return True, matching_actions[0].id
    return True, None


def _action_summary(action) -> str:
    if action.kind == "create_customer":
        data = action.data
        segment = f", segment {data.segment}" if data.segment else ", unscored segment"
        return (
            f"Create customer {data.customer_unique_id} with postal code prefix "
            f"{data.customer_zip_code_prefix}, in {data.customer_city}, "
            f"{data.customer_state.upper()}{segment}."
        )
    if action.kind == "update_customer":
        data = action.data
        segment = f", segment {data.segment}" if data.segment else ", segment unchanged"
        return (
            f"Update customer {action.customer_id}: unique ID "
            f"{data.customer_unique_id}, postal code prefix "
            f"{data.customer_zip_code_prefix}, city {data.customer_city}, "
            f"state {data.customer_state.upper()}{segment}."
        )
    if action.kind == "delete_customer":
        return (
            f"Delete customer {action.customer_id}. Customers with order history "
            "cannot be deleted."
        )
    if action.kind == "delete_orders":
        ids = ", ".join(action.order_ids)
        return (
            f"Delete {len(action.order_ids)} order(s) for customer "
            f"{action.customer_id}: {ids}. Associated order items, payments, "
            "and reviews will also be deleted."
        )
    return (
        f"Log a {action.data.interaction_type} interaction for customer "
        f"{action.customer_id}: {action.data.title}. "
        f"Description: {action.data.description}"
    )


def _action_payload(action) -> dict:
    return action.model_dump(mode="json")


def _action_for_intent(intent, db: Session, question: str):
    if intent.kind == "create_customer":
        if not intent.customer_city or not intent.customer_state or not intent.customer_zip_code_prefix:
            missing = []
            if not intent.customer_city:
                missing.append("city")
            if not intent.customer_state:
                missing.append("state code")
            if not intent.customer_zip_code_prefix:
                missing.append("postal code prefix")
            return None, f"I can create the customer, but I still need the {', '.join(missing)}."
        try:
            action = AssistantActionProposal.model_validate(
                {
                    "action": {
                        "kind": "create_customer",
                        "data": {
                            "customer_unique_id": intent.customer_unique_id,
                            "customer_city": intent.customer_city,
                            "customer_state": intent.customer_state,
                            "customer_zip_code_prefix": intent.customer_zip_code_prefix,
                        },
                    }
                }
            ).action
        except ValidationError as exc:
            raise HTTPException(
                status_code=422,
                detail="The customer details are incomplete or invalid. Please provide the city, state code, and postal code prefix.",
            ) from exc
        return action, None

    if intent.kind == "delete_orders":
        if not intent.customer_id:
            return None, "Which customer's order(s) should I delete? Please provide the customer ID."
        if not intent.order_ids:
            return None, "Which order ID(s) should I delete? Please provide the exact order ID(s)."
        try:
            action = DeleteOrdersAction(
                kind="delete_orders",
                customer_id=intent.customer_id,
                order_ids=intent.order_ids,
            )
        except ValidationError as exc:
            raise HTTPException(
                status_code=422,
                detail="Provide between 1 and 100 unique order IDs.",
            ) from exc
        return action, None

    customer_id = intent.customer_id or service.find_customer_id(db, question)
    if not customer_id:
        if intent.kind == "delete_customer":
            return None, "Which customer should I delete? Please provide their customer ID."
        return None, "Which customer should I use? Please provide their customer ID."

    if intent.kind == "delete_customer":
        return DeleteCustomerAction(
            kind="delete_customer",
            customer_id=customer_id,
        ), None

    if intent.kind == "update_customer":
        existing = db.execute(
            text(
                "SELECT customer_unique_id, customer_zip_code_prefix, "
                "customer_city, customer_state FROM customers "
                "WHERE customer_unique_id = :customer_id "
                "OR customer_id = :customer_id LIMIT 1"
            ),
            {"customer_id": customer_id},
        ).mappings().first()
        if not existing:
            return None, f"I couldn't find customer {customer_id}. Please check the ID."
        changed_fields = (
            intent.customer_unique_id,
            intent.customer_zip_code_prefix,
            intent.customer_city,
            intent.customer_state,
            intent.segment,
        )
        if not any(value is not None for value in changed_fields):
            return None, "What should I change on this customer's profile?"
        try:
            action = AssistantActionProposal.model_validate(
                {
                    "action": {
                        "kind": "update_customer",
                        "customer_id": customer_id,
                        "data": {
                            "customer_unique_id": intent.customer_unique_id or existing["customer_unique_id"],
                            "customer_zip_code_prefix": intent.customer_zip_code_prefix or existing["customer_zip_code_prefix"],
                            "customer_city": intent.customer_city or existing["customer_city"],
                            "customer_state": intent.customer_state or existing["customer_state"],
                            "segment": intent.segment,
                        },
                    }
                }
            ).action
        except ValidationError as exc:
            raise HTTPException(
                status_code=422,
                detail="The requested profile changes are invalid.",
            ) from exc
        return action, None

    required = {
        "interaction_type": intent.interaction_type,
        "title": intent.title,
        "description": intent.description,
    }
    missing = [field.replace("_", " ") for field, value in required.items() if not value]
    if missing:
        return None, f"I can log the interaction, but I still need the {', '.join(missing)}."
    try:
        action = AssistantActionProposal.model_validate(
            {
                "action": {
                    "kind": "log_interaction",
                    "customer_id": customer_id,
                    "data": {
                        "interaction_type": intent.interaction_type,
                        "title": intent.title,
                        "description": intent.description,
                    },
                }
            }
        ).action
    except ValidationError as exc:
        raise HTTPException(
            status_code=422,
            detail="The interaction details are incomplete or invalid.",
        ) from exc
    return action, None


def _persist_pending_action(action, db: Session, current_user: dict):
    if action.kind == "create_customer":
        if not action.data.customer_unique_id:
            for _ in range(5):
                candidate = secrets.token_hex(16)
                exists = db.execute(
                    text(
                        "SELECT 1 FROM customers WHERE customer_unique_id = :customer_id "
                        "OR customer_id = :customer_id LIMIT 1"
                    ),
                    {"customer_id": candidate},
                ).first()
                if not exists:
                    action = AssistantActionProposal.model_validate(
                        {
                            "action": {
                                "kind": "create_customer",
                                "data": {
                                    **action.data.model_dump(exclude={"customer_unique_id"}),
                                    "customer_unique_id": candidate,
                                },
                            }
                        }
                    ).action
                    break
            else:
                raise HTTPException(
                    status_code=503,
                    detail="Nova could not generate a unique customer ID. Please try again.",
                )
        existing = db.execute(
            text(
                "SELECT 1 FROM customers "
                "WHERE customer_unique_id = :customer_id "
                "OR customer_id = :customer_id LIMIT 1"
            ),
            {"customer_id": action.data.customer_unique_id},
        ).first()
        if existing:
            raise HTTPException(status_code=409, detail="Customer already exists.")
    else:
        existing = db.execute(
            text(
                "SELECT 1 FROM customers "
                "WHERE customer_unique_id = :customer_id "
                "OR customer_id = :customer_id LIMIT 1"
            ),
            {"customer_id": action.customer_id},
        ).first()
        if not existing:
            raise HTTPException(status_code=404, detail="Customer not found.")

    now = datetime.now(timezone.utc).replace(tzinfo=None)
    pending = AssistantPendingAction(
        id=secrets.token_urlsafe(32),
        user_id=current_user["user_id"],
        action_type=action.kind,
        payload=json.dumps(_action_payload(action), ensure_ascii=True),
        summary=_action_summary(action),
        status="pending",
        created_at=now,
        expires_at=now + ACTION_CONFIRMATION_TTL,
    )
    db.add(pending)
    try:
        db.commit()
    except SQLAlchemyError as exc:
        db.rollback()
        logger.exception("Could not save Nova's pending action.")
        raise HTTPException(
            status_code=503,
            detail="Nova could not prepare this action for confirmation.",
        ) from exc

    return AssistantActionPending(
        id=pending.id,
        summary=pending.summary,
        expires_at=pending.expires_at.replace(tzinfo=timezone.utc),
    )


@router.post("/actions", response_model=AssistantActionPending, status_code=201)
def propose_assistant_action(
    payload: AssistantActionProposal,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_page("assistant")),
):
    if current_user["role"] != "admin":
        raise HTTPException(
            status_code=403,
            detail="Only administrators can make customer changes through Nova.",
        )

    return _persist_pending_action(payload.action, db, current_user)


@router.post(
    "/actions/{action_id}/confirm",
    response_model=AssistantActionResult,
)
def confirm_assistant_action(
    action_id: str,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_page("assistant")),
):
    if current_user["role"] != "admin":
        raise HTTPException(
            status_code=403,
            detail="Only administrators can confirm customer changes through Nova.",
        )

    now = datetime.now(timezone.utc).replace(tzinfo=None)
    pending = (
        db.query(AssistantPendingAction)
        .filter_by(id=action_id, user_id=current_user["user_id"])
        .first()
    )
    if pending is None:
        raise HTTPException(status_code=404, detail="Pending action not found.")
    if pending.status != "pending":
        raise HTTPException(status_code=409, detail="This action is no longer pending.")
    if pending.expires_at <= now:
        pending.status = "expired"
        pending.completed_at = now
        db.commit()
        raise HTTPException(
            status_code=410,
            detail="This confirmation expired. Prepare the action again to continue.",
        )

    claimed = db.execute(
        update(AssistantPendingAction)
        .where(
            AssistantPendingAction.id == action_id,
            AssistantPendingAction.user_id == current_user["user_id"],
            AssistantPendingAction.status == "pending",
            AssistantPendingAction.expires_at > now,
        )
        .values(status="confirmed", completed_at=now)
    )
    if claimed.rowcount != 1:
        db.rollback()
        raise HTTPException(status_code=409, detail="This action is no longer pending.")

    try:
        action = AssistantActionProposal.model_validate(
            {"action": json.loads(pending.payload)}
        ).action
    except (json.JSONDecodeError, ValidationError) as exc:
        db.rollback()
        logger.exception("Persisted Nova action payload is invalid.")
        raise HTTPException(
            status_code=500,
            detail="This action cannot be executed.",
        ) from exc
    action_type = pending.action_type
    if action.kind != action_type:
        db.rollback()
        logger.error("Nova action type does not match its stored payload.")
        raise HTTPException(status_code=500, detail="This action cannot be executed.")
    try:
        if isinstance(action, CreateCustomerAction):
            from app.api.customers.router import add_customer

            add_customer(
                CustomerIn.model_validate(action.data.model_dump()),
                db,
                current_user,
            )
            message = "Customer created."
        elif isinstance(action, UpdateCustomerAction):
            from app.api.customers.router import update_customer

            update_customer(
                action.customer_id,
                action.data,
                db,
                current_user,
            )
            message = "Customer profile updated."
        elif isinstance(action, LogInteractionAction):
            from app.api.interactions.router import add_interaction

            add_interaction(
                action.customer_id,
                action.data,
                db,
                current_user,
            )
            message = "Customer interaction logged."
        elif isinstance(action, DeleteCustomerAction):
            from app.api.customers.router import delete_customer

            delete_customer(
                action.customer_id,
                db,
                current_user,
            )
            message = "Customer deleted."
        elif isinstance(action, DeleteOrdersAction):
            from app.api.orders.router import BulkOrderDeleteIn, bulk_delete_orders

            bulk_delete_orders(
                action.customer_id,
                BulkOrderDeleteIn(order_ids=action.order_ids),
                db,
                current_user,
            )
            message = (
                f"{len(action.order_ids)} order(s) and associated records deleted."
            )
        else:
            db.rollback()
            logger.error("Unknown persisted Nova action type: %s", action_type)
            raise HTTPException(status_code=500, detail="This action cannot be executed.")
    except HTTPException:
        db.rollback()
        raise
    except SQLAlchemyError as exc:
        db.rollback()
        logger.exception("Could not execute confirmed Nova action.")
        raise HTTPException(
            status_code=503,
            detail="The confirmed action could not be completed.",
        ) from exc

    return AssistantActionResult(message=message)


@router.delete("/actions/{action_id}", status_code=status.HTTP_204_NO_CONTENT)
def cancel_assistant_action(
    action_id: str,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_page("assistant")),
):
    pending = (
        db.query(AssistantPendingAction)
        .filter_by(
            id=action_id,
            user_id=current_user["user_id"],
            status="pending",
        )
        .first()
    )
    if pending is None:
        raise HTTPException(status_code=404, detail="Pending action not found.")
    pending.status = "cancelled"
    pending.completed_at = datetime.now(timezone.utc).replace(tzinfo=None)
    db.commit()


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


@router.post(
    "/ask",
    response_model=AssistantAnswer,
    response_model_exclude_none=True,
)
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

    if _is_explicit_action_confirmation(payload.question):
        try:
            is_proposal, action_id = await run_in_threadpool(
                _pending_action_for_latest_turn,
                db,
                current_user["user_id"],
                history,
            )
        except SQLAlchemyError as exc:
            logger.exception("Could not resolve Nova's pending action.")
            raise HTTPException(
                status_code=503,
                detail="Nova could not verify the pending action.",
            ) from exc
        if is_proposal:
            if action_id is None:
                return AssistantAnswer(
                    answer=(
                        "I couldn't match this confirmation to one pending action. "
                        "Please use the Confirm action button on the proposal."
                    )
                )
            result = await run_in_threadpool(
                confirm_assistant_action,
                action_id,
                db,
                current_user,
            )
            await run_in_threadpool(
                service.save_chat_turn,
                db,
                current_user["user_id"],
                payload.session_id,
                payload.question,
                result.message,
                [],
            )
            return AssistantAnswer(
                answer=result.message,
                confirmed_action_id=action_id,
            )

    domains = service.select_analytics_domains(payload.question)
    action_intent = None
    continuing_action = service.awaiting_customer_action_details(history)
    if service.looks_like_customer_action(payload.question) or continuing_action:
        if current_user["role"] != "admin":
            raise HTTPException(
                status_code=403,
                detail="Only administrators can make customer changes through Nova.",
            )
        try:
            action_intent = await service.extract_customer_action(
                payload.question,
                history,
            )
        except TimeoutError as exc:
            raise HTTPException(status_code=504, detail=str(exc)) from exc
        except ConnectionError as exc:
            raise HTTPException(status_code=502, detail=str(exc)) from exc

    customer_lookup_question = payload.question
    if (
        not service.customer_id_candidates(customer_lookup_question)
        and service.refers_to_customer(payload.question)
        and history
    ):
        customer_lookup_question = " ".join(
            [payload.question]
            + [turn["question"] for turn in reversed(history[-5:])]
        )

    if (
        service.customer_id_candidates(customer_lookup_question)
        and current_user["role"] != "admin"
        and "customers" not in current_user["access_pages"]
    ):
        raise HTTPException(
            status_code=403,
            detail="Access to customer records is not permitted.",
        )

    try:
        customer_id = await run_in_threadpool(
            service.find_customer_id,
            db,
            customer_lookup_question,
        )
    except SQLAlchemyError as exc:
        logger.exception("Could not resolve a customer identifier for Nova.")
        raise HTTPException(
            status_code=503,
            detail="Customer information is temporarily unavailable.",
        ) from exc

    if (
        not customer_id
        and service.customer_id_candidates(payload.question)
        and service.refers_to_customer(payload.question)
    ):
        answer = "I couldn't find a customer with the ID you provided. Please check the ID and try again."
        await run_in_threadpool(
            service.save_chat_turn,
            db,
            current_user["user_id"],
            payload.session_id,
            payload.question,
            answer,
            [],
        )
        return AssistantAnswer(answer=answer)
    if action_intent is not None and action_intent.kind != "none":
        try:
            action, clarification = await run_in_threadpool(
                _action_for_intent,
                action_intent,
                db,
                payload.question,
            )
            if clarification:
                await run_in_threadpool(
                    service.save_chat_turn,
                    db,
                    current_user["user_id"],
                    payload.session_id,
                    payload.question,
                    clarification,
                    [],
                )
                return AssistantAnswer(answer=clarification)

            pending_action = await run_in_threadpool(
                _persist_pending_action,
                action,
                db,
                current_user,
            )
            response_text = (
                "I prepared this customer change for your review. Nothing has been "
                "saved yet. Confirm below to proceed, or cancel it."
            )
            await run_in_threadpool(
                service.save_chat_turn,
                db,
                current_user["user_id"],
                payload.session_id,
                payload.question,
                f"{response_text} {pending_action.summary}",
                [],
            )
            return AssistantAnswer(
                answer=response_text,
                action_proposal=pending_action,
            )
        except HTTPException:
            raise
        except SQLAlchemyError as exc:
            db.rollback()
            logger.exception("Could not prepare Nova's customer action.")
            raise HTTPException(
                status_code=503,
                detail="Nova could not prepare that customer action.",
            ) from exc

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
        analytics_context.pop("privacy_note", None)

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
