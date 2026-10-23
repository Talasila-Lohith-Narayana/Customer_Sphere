from datetime import date, datetime, time, timedelta
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import text
from app.core.auth import auth
from app.core.database import get_db
from app.core.permissions import require_page
from app.models import AuditLog

router = APIRouter(tags=["audit-logs"])

# ------------------------------------------------------------------------------
# 1. Customer-Specific Audit Logs
# ------------------------------------------------------------------------------
@router.get("/api/customers/{cid}/audit-logs")
def get_audit_logs(
    cid: str,
    db: Session = Depends(get_db),
    _: str = Depends(auth),
    __: dict = Depends(require_page("customers")),
):
    """
    Fetches compliance audit history specifically for one customer.
    UI Component: Audit trail tab on `Customer.jsx`.
    """
    cust = db.execute(
        text("SELECT customer_id, customer_unique_id FROM customers WHERE customer_unique_id=:id OR customer_id=:id LIMIT 1"),
        {"id": cid}
    ).fetchone()
    ids = [cid]
    if cust:
        ids.extend([cust._mapping.get("customer_id"), cust._mapping.get("customer_unique_id")])
    ids = list(set([i for i in ids if i]))

    logs = (
        db.query(AuditLog)
        .filter(AuditLog.customer_id.in_(ids))
        .order_by(AuditLog.created_at.desc())
        .limit(50)
        .all()
    )
    return {"items": logs}


# ------------------------------------------------------------------------------
# 2. Global Platform Audit Log (All Admins & Operations)
# ------------------------------------------------------------------------------
@router.get("/api/audit-logs")
def get_global_audit_logs(
    limit: int = 100,
    action: str = None,
    q: str = None,
    performed_by: str = None,
    start_date: date = None,
    end_date: date = None,
    db: Session = Depends(get_db),
    _: str = Depends(auth),
    __: dict = Depends(require_page("audit_logs")),
):
    """
    Fetches all administrative activity and data change history across the entire platform.
    UI Component: `AuditLogModal.jsx` popup dialog.
    """
    query = db.query(AuditLog)
    if start_date and end_date and start_date > end_date:
        raise HTTPException(
            status_code=422,
            detail="start_date must be on or before end_date.",
        )
    if action:
        query = query.filter(AuditLog.action.ilike(f"%{action}%"))
    if performed_by and performed_by.strip():
        query = query.filter(AuditLog.performed_by.ilike(f"%{performed_by.strip()}%"))
    if start_date:
        query = query.filter(
            AuditLog.created_at >= datetime.combine(start_date, time.min)
        )
    if end_date:
        query = query.filter(
            AuditLog.created_at < datetime.combine(end_date + timedelta(days=1), time.min)
        )
    if q:
        query = query.filter(
            (AuditLog.customer_id.ilike(f"%{q}%"))
            | (AuditLog.details.ilike(f"%{q}%"))
            | (AuditLog.action.ilike(f"%{q}%"))
        )
    logs = query.order_by(AuditLog.created_at.desc()).limit(min(limit, 200)).all()
    return {"items": logs, "total": len(logs)}
