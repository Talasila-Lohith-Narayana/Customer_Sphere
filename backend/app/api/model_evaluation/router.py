from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query

from app.api.model_evaluation.schemas import (
    CalibrationResponse,
    ChurnDefinitionResponse,
    ImbalanceExperimentsResponse,
    ModelComparisonResponse,
    ModelVersionResponse,
    PerformanceSummaryResponse,
)
from app.api.model_evaluation import services
from app.core.permissions import require_any_page_access

router = APIRouter()


# ---------------------------------------------------------------------------
# 1. /model/performance-summary
# ---------------------------------------------------------------------------
@router.get(
    "/model/performance-summary",
    response_model=PerformanceSummaryResponse,
    summary="Get performance metrics for the active champion model",
    tags=["Model Evaluation"],
)
def get_performance_summary(_: dict = Depends(require_any_page_access("analytics", "model"))):
    """Retrieve test-set metrics (ROC-AUC, PR-AUC, F1, Precision, Recall, confusion matrix) for champion model."""
    try:
        return services.get_model_performance_summary()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to load performance summary: {exc}")


# ---------------------------------------------------------------------------
# 2. /model/comparison
# ---------------------------------------------------------------------------
@router.get(
    "/model/comparison",
    response_model=ModelComparisonResponse,
    summary="Compare champion and benchmark models",
    tags=["Model Evaluation"],
)
def get_comparison(_: dict = Depends(require_any_page_access("analytics", "model"))):
    """Benchmark table comparing Logistic Regression vs LightGBM across all key metrics."""
    try:
        return services.get_model_comparison()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to load model comparison: {exc}")


# ---------------------------------------------------------------------------
# 4. /model/version
# ---------------------------------------------------------------------------
@router.get(
    "/model/version",
    response_model=ModelVersionResponse,
    summary="Get active model metadata, parameters, and artifact path",
    tags=["Model Evaluation"],
)
def get_version(_: dict = Depends(require_any_page_access("analytics", "model"))):
    """Active model architecture, hyperparameters, features used, operating point, and artifact location."""
    try:
        return services.get_model_version_info()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to load model version metadata: {exc}")


# ---------------------------------------------------------------------------
# 5. /model/calibration
# ---------------------------------------------------------------------------
@router.get(
    "/model/calibration",
    response_model=CalibrationResponse,
    summary="Calibration comparison and Expected Calibration Error (ECE)",
    tags=["Model Evaluation"],
)
def get_calibration(_: dict = Depends(require_any_page_access("analytics", "model"))):
    """Probability calibration diagnostics: Brier score, log loss, ECE, and MCE comparison across methods."""
    try:
        return services.get_calibration_details()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to load calibration diagnostics: {exc}")


# ---------------------------------------------------------------------------
# 7. /model/imbalance-experiments
# ---------------------------------------------------------------------------
@router.get(
    "/model/imbalance-experiments",
    response_model=ImbalanceExperimentsResponse,
    summary="Benchmark results across class imbalance handling strategies",
    tags=["Experiments"],
)
def get_imbalance_experiments(
    model: str = Query("lightgbm", description="Model family: 'lightgbm' or 'logistic_regression'"),
    _: dict = Depends(require_any_page_access("analytics", "model")),
):
    """Results of class-weighting, undersampling, and oversampling strategies."""
    try:
        return services.get_imbalance_experiments(model=model)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to load imbalance experiments: {exc}")


# ---------------------------------------------------------------------------
# 8. /churn/definition
# ---------------------------------------------------------------------------
@router.get(
    "/churn/definition",
    response_model=ChurnDefinitionResponse,
    summary="Churn definition criteria, observation window, and customer counts",
    tags=["Churn Definitions"],
)
def get_churn_definition(_: dict = Depends(require_any_page_access("analytics", "model"))):
    """How churn is defined (return window, reference date) and retained vs churned vs censored customer counts."""
    try:
        return services.get_churn_definition_and_counts()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to load churn definition: {exc}")
