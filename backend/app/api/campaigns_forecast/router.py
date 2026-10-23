from __future__ import annotations

import logging
from typing import Any, Callable

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.exc import OperationalError, ProgrammingError

from app.api.campaigns_forecast import repository as repo
from app.api.campaigns_forecast.schemas import (
    ActiveCampaign,
    ActiveCampaignsResponse,
    CampaignCustomer,
    CampaignCustomersResponse,
    EvaluateRequest,
    EvaluateResponse,
    SegmentCampaign,
    SegmentCampaignsRow,
)
from app.core.permissions import require_any_page_access, require_page
from app.segmentation.customer_intelligence.campaign_engine.campaign_rules_loader import (
    load_campaign_rules_config,
)

logger = logging.getLogger(__name__)

router = APIRouter(tags=["Campaigns, churn correlations & forecasting"])

HIGH_PRIORITY_MAX = 2  # campaign_priority 1-2 counts as "high priority"


def _db(fn: Callable[..., Any], *args: Any, **kwargs: Any) -> Any:

    try:
        return fn(*args, **kwargs)
    except (ProgrammingError, OperationalError) as exc:
        logger.exception("Database error in %s", getattr(fn, "__name__", fn))
        raise HTTPException(
            status_code=503,
            detail=(
                "A required table is missing or the database is unavailable. "
                "Run scripts/run_pipeline.py so the pipeline tables exist. "
                f"({exc.orig})"
            ),
        ) from exc


def _explain(code: str) -> str:
    return load_campaign_rules_config().reason_codes.get(code, "")


# ======================================================================
# Campaigns
# ======================================================================
@router.get("/campaigns/active", response_model=ActiveCampaignsResponse)
def campaigns_active(_: dict = Depends(require_any_page_access("analytics", "campaigns"))):
 
    rows = _db(repo.active_campaigns)
    campaigns = [ActiveCampaign(**row) for row in rows]
    return ActiveCampaignsResponse(
        active_campaigns=len(campaigns),
        customers_targeted=sum(c.customer_count for c in campaigns),
        high_priority_customers=sum(
            c.customer_count for c in campaigns if c.campaign_priority <= HIGH_PRIORITY_MAX
        ),
        campaigns=campaigns,
    )


@router.get("/campaigns/by-segment", response_model=list[SegmentCampaignsRow])
def campaigns_by_segment(_: dict = Depends(require_any_page_access("analytics", "campaigns"))):
    """Which campaigns each customer segment is getting, with counts (for a stacked bar / table)."""
    rows = _db(repo.campaigns_by_segment)
    grouped: dict[str, SegmentCampaignsRow] = {}
    for row in rows:
        entry = grouped.setdefault(
            row["segment_label"],
            SegmentCampaignsRow(segment_label=row["segment_label"], total_customers=0, campaigns=[]),
        )
        entry.total_customers += row["customer_count"]
        entry.campaigns.append(
            SegmentCampaign(
                campaign_name=row["campaign_name"],
                campaign_priority=row["campaign_priority"],
                reason_code=row["reason_code"],
                customer_count=row["customer_count"],
            )
        )
    return sorted(grouped.values(), key=lambda s: s.total_customers, reverse=True)


@router.get("/campaigns/{campaign_name}/customers", response_model=CampaignCustomersResponse)
def campaign_customers(
    campaign_name: str,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=500),
    _: dict = Depends(require_any_page_access("analytics", "campaigns")),
):
    """Customers targeted by one campaign (highest churn probability first) for drill-down."""
    total = _db(repo.campaign_customer_count, campaign_name)
    if total == 0:
        raise HTTPException(status_code=404, detail=f"No customers found for campaign: {campaign_name}")
    rows = _db(repo.campaign_customers_page, campaign_name, page_size, (page - 1) * page_size)
    return CampaignCustomersResponse(
        campaign_name=campaign_name,
        total=total,
        page=page,
        page_size=page_size,
        items=[CampaignCustomer(**row) for row in rows],
    )


@router.post("/campaigns/evaluate", response_model=EvaluateResponse)
def campaigns_evaluate(
    payload: EvaluateRequest,
    _: dict = Depends(require_page("customers")),
):
    """Suggest a campaign (and why) for one customer.

    - With `customer_unique_id`: returns the stored recommendation; if the customer isn't
      in the table but a full profile was also sent, falls back to the rulebook.
    - With `risk_tier` + `segment_label` + `value_tier`: applies the YAML rulebook directly
      (useful for "what if" checks from the dashboard).
    """
    config = load_campaign_rules_config()
    has_profile = all([payload.risk_tier, payload.segment_label, payload.value_tier])

    stored = _db(repo.recommendation_for_customer, payload.customer_unique_id) if payload.customer_unique_id else None

    if stored:
        _, explicit = config.lookup(stored["risk_tier"], stored["segment_label"], stored["value_tier"])
        return EvaluateResponse(
            **stored,
            reason=_explain(stored["reason_code"]),
            matched_explicit_rule=explicit,
            source="database",
        )

    if not has_profile:
        raise HTTPException(
            status_code=404,
            detail=f"No campaign recommendation found for customer_unique_id: {payload.customer_unique_id}",
        )

    rule, explicit = config.lookup(payload.risk_tier, payload.segment_label, payload.value_tier)
    return EvaluateResponse(
        customer_unique_id=payload.customer_unique_id,
        risk_tier=payload.risk_tier,
        segment_label=payload.segment_label,
        value_tier=payload.value_tier,
        campaign_name=rule.campaign_name,
        campaign_priority=rule.campaign_priority,
        reason_code=rule.reason_code,
        reason=_explain(rule.reason_code),
        matched_explicit_rule=explicit,
        source="rules",
    )

