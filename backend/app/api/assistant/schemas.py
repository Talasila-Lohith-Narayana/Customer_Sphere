from pydantic import BaseModel, Field, field_validator


class AssistantQuestion(BaseModel):
    question: str = Field(min_length=1, max_length=1000)

    @field_validator("question")
    @classmethod
    def question_must_not_be_blank(cls, value: str) -> str:
        question = value.strip()
        if not question:
            raise ValueError("Question must not be blank.")
        return question


class AssistantAnswer(BaseModel):
    answer: str


class AssistantStatus(BaseModel):
    configured: bool
    model: str
