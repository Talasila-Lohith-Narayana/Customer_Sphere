import json
from dataclasses import dataclass
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

Operator = Literal["<", "<=", ">", ">=", "="]
Period = Literal["this month", "last month", "last quarter", "last year"] | None


class ToolArguments(BaseModel):
    model_config = ConfigDict(extra="forbid")


class EmptyArguments(ToolArguments):
    pass


class PeriodArguments(ToolArguments):
    period: Period = None


class ThresholdArguments(ToolArguments):
    operator: Operator
    threshold: int = Field(strict=True, ge=0, le=10000)
    period: Period = None


class SpendArguments(ToolArguments):
    operator: Operator
    threshold: float = Field(ge=0, le=1000000000)
    period: Period = None


class PaymentMethodArguments(ToolArguments):
    payment_method: Literal["credit_card", "debit_card", "boleto", "voucher"]


class InstallmentArguments(ToolArguments):
    operator: Operator
    threshold: int = Field(strict=True, ge=1, le=24)
    period: Period = None


class RatingArguments(ToolArguments):
    operator: Operator
    rating: int = Field(strict=True, ge=1, le=5)


class ProductCustomersArguments(ToolArguments):
    category: str | None = Field(default=None, min_length=1, max_length=64)
    product_id: str | None = Field(
        default=None,
        min_length=8,
        max_length=64,
        pattern=r"^[A-Za-z0-9_-]+$",
    )

    @field_validator("category")
    @classmethod
    def clean_category(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = value.strip()
        if not value:
            raise ValueError("Category cannot be blank.")
        return value

    @model_validator(mode="after")
    def require_category_or_product_id(self):
        if self.category is None and self.product_id is None:
            raise ValueError("Specify a product category or product ID.")
        return self


class StateArguments(ToolArguments):
    state: str | None = Field(default=None, pattern=r"^[A-Z]{2}$")


@dataclass(frozen=True)
class AnalyticsToolPlan:
    name: str
    arguments: dict[str, Any]
    metric: str
    domains: frozenset[str]
    question: str


_TOOL_DEFINITIONS = {
    "get_monthly_sales": (
        "Read aggregate monthly sales for an optional supported period.",
        PeriodArguments,
        "monthly_sales",
        frozenset({"sales"}),
    ),
    "count_customers_by_order_count": (
        "Count customers whose distinct order count matches a threshold.",
        ThresholdArguments,
        "customers_by_order_count",
        frozenset({"customers", "sales"}),
    ),
    "count_customers_by_spend": (
        "Count customers whose total spending matches a BRL threshold.",
        SpendArguments,
        "customers_by_spend",
        frozenset({"customers", "sales"}),
    ),
    "count_customers_by_payment_method": (
        "Count customers by a supported payment method.",
        PaymentMethodArguments,
        "customers_by_payment_method",
        frozenset({"customers", "sales"}),
    ),
    "count_customers_by_installments": (
        "Count customers whose payment installment count matches a threshold.",
        InstallmentArguments,
        "customers_by_installments",
        frozenset({"customers", "installments"}),
    ),
    "count_reviews_by_rating": (
        "Count reviews matching a rating threshold from one to five stars.",
        RatingArguments,
        "reviews_by_rating",
        frozenset({"reviews"}),
    ),
    "list_customers_by_product": (
        "List the aggregate customer cohort for a product category or product ID.",
        ProductCustomersArguments,
        "customers_by_product_category",
        frozenset({"customers", "products", "relationships"}),
    ),
    "get_customers_by_state": (
        "Return the aggregate customer distribution for an optional two-letter state.",
        StateArguments,
        "customers_by_state",
        frozenset({"customers", "geography"}),
    ),
    "rank_product_categories_by_revenue": (
        "Rank product categories by aggregate revenue.",
        EmptyArguments,
        "product_category_revenue",
        frozenset({"products", "sales"}),
    ),
    "get_churn_risk_distribution": (
        "Return the aggregate customer churn-risk distribution.",
        EmptyArguments,
        "churn_risk",
        frozenset({"churn"}),
    ),
    "count_orders_by_delivery_time": (
        "Count delivered orders whose delivery time matches a day threshold.",
        ThresholdArguments,
        "orders_by_delivery_time",
        frozenset({"delivery", "sales"}),
    ),
}

_OPERATOR_PHRASES = {
    "<": "less than",
    "<=": "at most",
    ">": "more than",
    ">=": "at least",
    "=": "exactly",
}


def _period_phrase(period: str | None) -> str:
    return f" {period}" if period else ""


def _tool_question(name: str, arguments: dict[str, Any]) -> str:
    if name == "get_monthly_sales":
        return f"Show monthly revenue trends{_period_phrase(arguments.get('period'))}"
    if name == "count_customers_by_order_count":
        return (
            "How many customers have "
            f"{_OPERATOR_PHRASES[arguments['operator']]} "
            f"{arguments['threshold']} orders"
            f"{_period_phrase(arguments.get('period'))}?"
        )
    if name == "count_customers_by_spend":
        return (
            "How many customers spent "
            f"{_OPERATOR_PHRASES[arguments['operator']]} "
            f"{arguments['threshold']:g} BRL"
            f"{_period_phrase(arguments.get('period'))}?"
        )
    if name == "count_customers_by_payment_method":
        payment_method = arguments["payment_method"].replace("_", " ")
        return f"How many customers used {payment_method}?"
    if name == "count_customers_by_installments":
        return (
            "How many customers paid in "
            f"{_OPERATOR_PHRASES[arguments['operator']]} "
            f"{arguments['threshold']} installments"
            f"{_period_phrase(arguments.get('period'))}?"
        )
    if name == "count_reviews_by_rating":
        return (
            "How many reviews were rated "
            f"{_OPERATOR_PHRASES[arguments['operator']]} "
            f"{arguments['rating']} stars?"
        )
    if name == "list_customers_by_product":
        if arguments.get("product_id"):
            return f"Which customers bought product ID {arguments['product_id']}?"
        return f"Which customers bought category {arguments['category']}?"
    if name == "get_customers_by_state":
        state = arguments.get("state")
        return (
            f"Show customer distribution by state {state}"
            if state
            else "How many customers are in each state?"
        )
    if name == "rank_product_categories_by_revenue":
        return "Which product categories have the top revenue?"
    if name == "get_churn_risk_distribution":
        return "Show customer churn risk distribution."
    if name == "count_orders_by_delivery_time":
        return (
            "How many orders are delivered "
            f"{_OPERATOR_PHRASES[arguments['operator']]} "
            f"{arguments['threshold']} days?"
        )
    raise ValueError(f"Unknown analytics tool: {name}")


def analytics_tool_schemas() -> list[dict[str, Any]]:
    return [
        {
            "type": "function",
            "function": {
                "name": name,
                "description": definition[0],
                "parameters": definition[1].model_json_schema(),
            },
        }
        for name, definition in _TOOL_DEFINITIONS.items()
    ]


def parse_analytics_tool_call(name: str, arguments: str | dict[str, Any]) -> AnalyticsToolPlan:
    definition = _TOOL_DEFINITIONS.get(name)
    if definition is None:
        raise ValueError(f"Unsupported analytics tool: {name}")
    try:
        payload = json.loads(arguments) if isinstance(arguments, str) else arguments
        validated = definition[1].model_validate(payload)
    except (json.JSONDecodeError, TypeError, ValueError) as exc:
        raise ValueError(f"Invalid arguments for analytics tool {name}.") from exc
    values = validated.model_dump(exclude_none=True)
    return AnalyticsToolPlan(
        name=name,
        arguments=values,
        metric=definition[2],
        domains=definition[3],
        question=_tool_question(name, values),
    )


def tool_name_for_metric(metric: str) -> str | None:
    return next(
        (
            name
            for name, definition in _TOOL_DEFINITIONS.items()
            if definition[2] == metric
        ),
        None,
    )
