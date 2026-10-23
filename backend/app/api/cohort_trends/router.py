
from datetime import date
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.engine import Engine

from app.api.cohort_trends import schemas as schemas
from app.api.cohort_trends import services as svc
from app.core.permissions import require_page

router = APIRouter(tags=["Trends & Cohorts"])

COHORT_PATTERN = r"^\d{4}-(0[1-9]|1[0-2])$"          # e.g. 2017-03
Granularity = Literal["daily", "weekly", "monthly"]


def get_engine() -> Engine:
    """Shared DB engine. Imported lazily so tests can swap it via
    app.dependency_overrides without needing a real .env / MySQL."""
    from app.core.database import engine
    return engine


# ----------------------------------------------------------------------
# Shared query parameters
# ----------------------------------------------------------------------
class TrendParams:
    def __init__(
        self,
        granularity: Granularity = Query("monthly", description="Time bucket for each point"),
        start_date: Optional[date] = Query(None, description="Include periods on/after this date"),
        end_date: Optional[date] = Query(None, description="Include periods on/before this date"),
    ):
        if start_date and end_date and start_date > end_date:
            raise HTTPException(400, "start_date must be on or before end_date")
        self.granularity, self.start_date, self.end_date = granularity, start_date, end_date


class CohortRange:
    def __init__(
        self,
        cohort_from: Optional[str] = Query(None, pattern=COHORT_PATTERN, description="First cohort, e.g. 2017-01"),
        cohort_to: Optional[str] = Query(None, pattern=COHORT_PATTERN, description="Last cohort, e.g. 2017-12"),
    ):
        if cohort_from and cohort_to and cohort_from > cohort_to:
            raise HTTPException(400, "cohort_from must be on or before cohort_to")
        self.cohort_from, self.cohort_to = cohort_from, cohort_to


def _trend_response(engine: Engine, p: TrendParams, table: str, model) -> dict:
    """Load one trend table with exactly the fields `model` exposes."""
    columns = list(model.model_fields)
    rows = svc.to_records(svc.get_trend(engine, table, p.granularity, columns, p.start_date, p.end_date))
    return {"granularity": p.granularity, "count": len(rows), "data": rows}


# ----------------------------------------------------------------------
# Cohorts  (fixed paths must be declared before /cohort/{cohort})
# ----------------------------------------------------------------------
def _cohort_list(df, data) -> dict:
    return {"generated_date": svc.generated_date(df), "count": len(data), "data": data}


@router.get("/cohort/summary", response_model=schemas.CohortSummaryResponse,
            summary="One summary row per cohort")
def cohort_summary(
    r: CohortRange = Depends(),
    engine: Engine = Depends(get_engine),
    _: dict = Depends(require_page("analytics")),
):
    df = svc.get_cohorts(engine, r.cohort_from, r.cohort_to)
    return _cohort_list(df, svc.cohort_summary(df))
