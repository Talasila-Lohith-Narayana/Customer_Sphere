from datetime import datetime
from typing import Annotated, Literal, Union

from pydantic import BaseModel, Field, field_validator

from app.schemas import CustomerIn, InteractionIn


class AssistantQuestion(BaseModel):
    question: str = Field(min_length=1, max_length=1000)
    session_id: int = Field(gt=0)

    @field_validator("question")
    @classmethod
    def question_must_not_be_blank(cls, value: str) -> str:
        question = value.strip()
        if not question:
            raise ValueError("Question must not be blank.")
        return question


class AssistantChartDatum(BaseModel):
    label: str
    value: int | float


class AssistantVisualization(BaseModel):
    title: str
    data: list[AssistantChartDatum]
    format: Literal["number", "currency"]


class AssistantChatTurn(BaseModel):
    question: str
    answer: str
    visualizations: list[AssistantVisualization] = Field(default_factory=list)


class AssistantHistory(BaseModel):
    turns: list[AssistantChatTurn] = Field(default_factory=list)


class AssistantChatSession(BaseModel):
    id: int
    title: str
    created_at: datetime
    updated_at: datetime


class AssistantChatSessionUpdate(BaseModel):
    title: str = Field(min_length=1, max_length=120)

    @field_validator("title")
    @classmethod
    def title_must_not_be_blank(cls, value: str) -> str:
        title = value.strip()
        if not title:
            raise ValueError("Conversation title must not be blank.")
        return title


class AssistantChatSessions(BaseModel):
    sessions: list[AssistantChatSession] = Field(default_factory=list)


class AssistantStatus(BaseModel):
    configured: bool
    model: str


class CreateCustomerAction(BaseModel):
    kind: Literal["create_customer"]

    class Data(BaseModel):
        customer_unique_id: str | None = Field(default=None, max_length=32)
        customer_zip_code_prefix: str = Field(
            min_length=1,
            max_length=6,
            pattern=r"^[0-9]{1,6}$",
        )
        customer_city: str = Field(min_length=1, max_length=100)
        customer_state: str = Field(min_length=2, max_length=2)
        segment: str | None = None

        @field_validator("customer_unique_id", mode="before")
        @classmethod
        def clean_customer_id(cls, value: str | None) -> str | None:
            if value is None or not isinstance(value, str):
                return None
            cleaned = value.strip()
            return cleaned or None

        @field_validator(
            "customer_zip_code_prefix",
            "customer_city",
            "customer_state",
            mode="before",
        )
        @classmethod
        def clean_required_strings(cls, value: str) -> str:
            if not isinstance(value, str):
                return value
            cleaned = value.strip()
            if not cleaned:
                raise ValueError("Field cannot be left blank")
            return cleaned

    data: Data


class UpdateCustomerAction(BaseModel):
    kind: Literal["update_customer"]
    customer_id: str = Field(min_length=1, max_length=32)
    data: CustomerIn


class LogInteractionAction(BaseModel):
    kind: Literal["log_interaction"]
    customer_id: str = Field(min_length=1, max_length=32)
    data: InteractionIn


class DeleteCustomerAction(BaseModel):
    kind: Literal["delete_customer"]
    customer_id: str = Field(min_length=1, max_length=32)


class DeleteOrdersAction(BaseModel):
    kind: Literal["delete_orders"]
    customer_id: str = Field(min_length=1, max_length=32)
    order_ids: list[str] = Field(min_length=1, max_length=100)

    @field_validator("order_ids")
    @classmethod
    def order_ids_must_be_unique(cls, value: list[str]) -> list[str]:
        if len(set(value)) != len(value):
            raise ValueError("Order IDs must be unique.")
        return value


AssistantAction = Annotated[
    Union[
        CreateCustomerAction,
        UpdateCustomerAction,
        LogInteractionAction,
        DeleteCustomerAction,
        DeleteOrdersAction,
    ],
    Field(discriminator="kind"),
]


class AssistantActionProposal(BaseModel):
    action: AssistantAction


class AssistantActionPending(BaseModel):
    id: str
    summary: str
    expires_at: datetime


class AssistantActionResult(BaseModel):
    message: str


class CustomerActionIntent(BaseModel):
    kind: Literal[
        "none",
        "create_customer",
        "update_customer",
        "log_interaction",
        "delete_customer",
        "delete_orders",
    ]
    customer_id: str | None = None
    order_ids: list[str] = Field(default_factory=list)
    customer_unique_id: str | None = None
    customer_zip_code_prefix: str | None = None
    customer_city: str | None = None
    customer_state: str | None = None
    segment: str | None = None
    interaction_type: str | None = None
    title: str | None = None
    description: str | None = None
    missing_fields: list[str] = Field(default_factory=list)

    @field_validator(
        "customer_id",
        "customer_unique_id",
        "customer_zip_code_prefix",
        "customer_city",
        "customer_state",
        "segment",
        "interaction_type",
        "title",
        "description",
        mode="before",
    )
    @classmethod
    def clean_optional_strings(cls, value: str | None) -> str | None:
        if value is None or not isinstance(value, str):
            return None
        cleaned = value.strip()
        return cleaned or None


class AssistantAnswer(BaseModel):
    answer: str
    visualizations: list[AssistantVisualization] = Field(default_factory=list)
    action_proposal: AssistantActionPending | None = None
    confirmed_action_id: str | None = None
