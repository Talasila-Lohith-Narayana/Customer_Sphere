import logging
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import text
from app.core.auth import auth, admin_auth
from app.core.database import get_db
from app.models import ConsumerInteraction, AuditLog
from app.schemas import InteractionIn
from app.api.assistant import retrieval

router = APIRouter(tags=["interactions"])
logger = logging.getLogger(__name__)


def _index_interaction(obj: ConsumerInteraction) -> None:
    try:
        retrieval.index_interaction(
            obj.id,
            obj.customer_id,
            obj.interaction_type,
            obj.title,
            obj.description,
            obj.created_at,
        )
    except Exception:
        logger.exception(
            "Could not update the local semantic index for interaction %s.",
            obj.id,
        )

# ------------------------------------------------------------------------------
# 1. Fetch Customer Interaction History
# ------------------------------------------------------------------------------
@router.get("/api/customers/{cid}/interactions")
def interactions(cid: str, db: Session = Depends(get_db), _: str = Depends(auth)):
    """
    Retrieves the CRM communications timeline for a specific customer.
    UI Component: Activity timeline on `Customer.jsx`.
    """
    cust = db.execute(
        text("SELECT customer_id, customer_unique_id FROM customers WHERE customer_unique_id=:id OR customer_id=:id LIMIT 1"),
        {"id": cid}
    ).fetchone()
    ids = [cid]
    if cust:
        ids.extend([cust._mapping.get("customer_id"), cust._mapping.get("customer_unique_id")])
    ids = list(set([i for i in ids if i]))

    return (
        db.query(ConsumerInteraction)
        .filter(ConsumerInteraction.customer_id.in_(ids))
        .order_by(ConsumerInteraction.created_at.desc())
        .limit(50)
        .all()
    )


# ------------------------------------------------------------------------------
# 2. Log New CRM Interaction (Admin Only)
# ------------------------------------------------------------------------------
@router.post("/api/customers/{cid}/interactions")
def add_interaction(
    cid: str,
    x: InteractionIn,
    db: Session = Depends(get_db),
    u: dict = Depends(admin_auth),
):
    """
    Records a new touchpoint (Call, Email, Note, Support) and creates an audit trail.
    UI Component: 'Log interaction' modal (`InteractionModal.jsx`).
    """
    cust = db.execute(
        text("SELECT customer_id, customer_unique_id FROM customers WHERE customer_unique_id=:id OR customer_id=:id LIMIT 1"),
        {"id": cid}
    ).fetchone()
    if not cust:
        raise HTTPException(404, "Customer not found")
    target_id = cust._mapping.get("customer_unique_id") or cid

    obj = ConsumerInteraction(
        customer_id=target_id,
        interaction_type=x.interaction_type,
        title=x.title,
        description=x.description,
        created_at=datetime.now(timezone.utc).replace(tzinfo=None),
    )
    db.add(obj)
    db.add(
        AuditLog(
            customer_id=target_id,
            action=f"Logged interaction ({x.interaction_type})",
            performed_by=u.get("sub", "admin"),
            details=f"Title: {x.title}",
            created_at=datetime.now(timezone.utc).replace(tzinfo=None),
        )
    )
    db.commit()
    db.refresh(obj)
    _index_interaction(obj)
    return obj


# ------------------------------------------------------------------------------
# 3. Edit Interaction Note (Admin Only)
# ------------------------------------------------------------------------------
@router.patch("/api/customers/{cid}/interactions/{interaction_id}")
def update_interaction(
    cid: str,
    interaction_id: int,
    x: InteractionIn,
    db: Session = Depends(get_db),
    u: dict = Depends(admin_auth),
):
    """
    Updates an interaction note and logs the edit.
    UI Component: 'Edit' button on interaction cards in `Customer.jsx`.
    """
    cust = db.execute(
        text("SELECT customer_id, customer_unique_id FROM customers WHERE customer_unique_id=:id OR customer_id=:id LIMIT 1"),
        {"id": cid}
    ).fetchone()
    if not cust:
        raise HTTPException(404, "Customer not found")
    target_id = cust._mapping.get("customer_unique_id") or cid

    obj = db.query(ConsumerInteraction).filter(ConsumerInteraction.id == interaction_id).first()
    if not obj:
        raise HTTPException(404, "Interaction not found")

    obj.interaction_type = x.interaction_type
    obj.title = x.title
    obj.description = x.description

    db.add(
        AuditLog(
            customer_id=target_id,
            action=f"Updated interaction ({x.interaction_type})",
            performed_by=u.get("sub", "admin"),
            details=f"Updated title: {x.title}",
            created_at=datetime.now(timezone.utc).replace(tzinfo=None),
        )
    )
    db.commit()
    db.refresh(obj)
    _index_interaction(obj)
    return obj
