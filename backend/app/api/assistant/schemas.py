from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator


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


class AssistantAnswer(BaseModel):
    answer: str
    visualizations: list[AssistantVisualization] = Field(default_factory=list)


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
