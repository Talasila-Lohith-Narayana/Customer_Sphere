from datetime import datetime, date
from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator

# ------------------------------------------------------------------------------
# 1. User Login Form Blueprint
# ------------------------------------------------------------------------------
AccessPage = Literal[
    "dashboard",
    "customers",
    "products",
    "analytics",
    "campaigns",
    "model",
    "audit_logs",
]


class Login(BaseModel):
    username: str = Field(min_length=3, max_length=80, description="Login username")
    password: str = Field(min_length=6, max_length=128, description="Login password")


class UserCreate(BaseModel):
    username: str = Field(min_length=3, max_length=80, description="Login username")
    password: str = Field(min_length=8, max_length=128, description="Initial password")
    role: Literal["admin", "viewer"] = Field(
        default="viewer",
        description="Account access role",
    )
    access_pages: list[AccessPage] | None = Field(
        default=None,
        description="Application pages this viewer may access",
    )

    @field_validator("username")
    @classmethod
    def clean_username(cls, value):
        value = value.strip()
        if not 3 <= len(value) <= 80:
            raise ValueError("Username must contain between 3 and 80 characters")
        return value

    @model_validator(mode="after")
    def require_viewer_access(self):
        if self.role == "viewer" and self.access_pages is not None and not self.access_pages:
            raise ValueError("Select at least one page for a viewer.")
        return self


class UserSummary(BaseModel):
    username: str
    role: Literal["admin", "viewer"]
    access_pages: list[AccessPage]


class ProfileSummary(BaseModel):
    username: str
    role: Literal["admin", "viewer"]


class UserUpdateResult(UserSummary):
    access_token: str | None = None
    sessions_revoked: bool = False


class UserUpdate(BaseModel):
    username: str | None = Field(default=None, min_length=3, max_length=80)
    password: str | None = Field(default=None, min_length=8, max_length=128)
    access_pages: list[AccessPage] | None = Field(
        default=None,
        description="Application pages this viewer may access",
    )

    @field_validator("username")
    @classmethod
    def clean_updated_username(cls, value):
        if value is None:
            return value
        value = value.strip()
        if not 3 <= len(value) <= 80:
            raise ValueError("Username must contain between 3 and 80 characters")
        return value

    @model_validator(mode="after")
    def require_update(self):
        if (
            self.username is None
            and self.password is None
            and self.access_pages is None
        ):
            raise ValueError("Provide a username, password, or page-access update.")
        if self.access_pages is not None and not self.access_pages:
            raise ValueError("Select at least one page for a viewer.")
        return self


# ------------------------------------------------------------------------------
# 2. Add / Edit Customer Form Blueprint
# ------------------------------------------------------------------------------
class CustomerIn(BaseModel):
    customer_unique_id: str = Field(min_length=1, max_length=32, description="Unique 32-character customer hash")
    customer_zip_code_prefix: str = Field(
        min_length=1,
        max_length=6,
        pattern=r"^[0-9]{1,6}$",
        description="Up to 6-digit postal code prefix",
    )
    customer_city: str = Field(min_length=1, max_length=100, description="City name")
    customer_state: str = Field(min_length=2, max_length=2, description="2-letter Brazilian state code (e.g. SP, RJ)")
    segment: str | None = Field(default=None, description="Optional RFM customer segment")

    @field_validator("customer_zip_code_prefix", mode="before")
    @classmethod
    def clean_postal_prefix(cls, value):
        if isinstance(value, int) and not isinstance(value, bool):
            value = str(value)
        if not isinstance(value, str):
            raise ValueError("Postal code prefix must contain 1 to 6 digits")
        value = value.strip()
        if not 1 <= len(value) <= 6 or not value.isascii() or not value.isdigit():
            raise ValueError("Postal code prefix must contain 1 to 6 digits")
        return value

    @field_validator("customer_unique_id", "customer_city", "customer_state")
    @classmethod
    def clean(cls, v):
        v = v.strip()
        if not v:
            raise ValueError("Field cannot be left blank")
        return v

    @field_validator("segment")
    @classmethod
    def clean_segment(cls, v):
        if v is not None:
            v = v.strip()
            allowed = [
                "High Risk",
                "Medium Risk",
                "Low Risk",
            ]
            if v and v not in allowed:
                raise ValueError(f"Segment must be one of: {', '.join(allowed)}")
        return v


# ------------------------------------------------------------------------------
# 3. Log / Edit Interaction Note Blueprint (CRM Timeline)
# ------------------------------------------------------------------------------
class InteractionIn(BaseModel):
    interaction_type: str = Field(min_length=2, max_length=50, description="Type: Call, Email, Meeting, Note, Support")
    title: str = Field(min_length=3, max_length=120, description="Subject of the interaction note")
    description: str = Field(min_length=5, max_length=1000, description="Detailed notes of what happened")

    @field_validator("interaction_type", "title", "description")
    @classmethod
    def clean(cls, v):
        v = v.strip()
        if not v:
            raise ValueError("Field cannot be left blank")
        return v


# ------------------------------------------------------------------------------
# 4. Multi-Item Order Blueprint (Order Modal)
# ------------------------------------------------------------------------------
class OrderItemIn(BaseModel):
    product_category: str = Field(min_length=2, max_length=64, description="Product category name (e.g. beleza_saude)")
    product_id: str | None = Field(default=None, max_length=32, description="Specific product hash ID")
    price: float = Field(gt=0, le=100000, description="Item price in Brazilian Reais (R$)")
    freight_value: float = Field(ge=0, le=10000, default=0.0, description="Shipping cost in R$")


class OrderIn(BaseModel):
    product_category: str | None = Field(default=None, max_length=64)
    product_id: str | None = Field(default=None, max_length=32)
    price: float | None = Field(default=None, gt=0, le=100000)
    freight_value: float | None = Field(default=None, ge=0, le=10000)
    items: list[OrderItemIn] | None = None
    payment_type: str = Field(min_length=3, max_length=16, description="Credit card, Boleto, Voucher, Debit card")
    payment_installments: int = Field(ge=1, le=24, default=1, description="Number of installments (1 to 24)")
    order_status: str = Field(min_length=3, max_length=16, default="delivered")
    order_purchase_timestamp: str | None = None
    order_delivered_customer_date: str | None = None

    @field_validator("payment_type", "order_status")
    @classmethod
    def clean_str(cls, v):
        v = v.strip()
        if not v:
            raise ValueError("Field cannot be blank")
        return v

    @field_validator("order_purchase_timestamp")
    @classmethod
    def validate_purchase_date(cls, v):
        if v:
            clean = v.strip()
            try:
                dt = datetime.fromisoformat(clean.replace("Z", "+00:00"))
                d = dt.date()
                if d < date(2016, 9, 1) or d > date(2018, 10, 31):
                    raise ValueError("Purchase date must be within database timeline (Sep 2016 to Oct 2018)")
            except ValueError as e:
                if "within database timeline" in str(e):
                    raise
                if clean[:10] < "2016-09-01" or clean[:10] > "2018-10-31":
                    raise ValueError("Purchase date must be within database timeline (Sep 2016 to Oct 2018)")
            return clean
        return v

    @field_validator("order_delivered_customer_date")
    @classmethod
    def validate_delivered_date(cls, v):
        if v:
            clean = v.strip()
            try:
                dt = datetime.fromisoformat(clean.replace("Z", "+00:00"))
                d = dt.date()
                if d < date(2016, 9, 1) or d > date(2018, 10, 31):
                    raise ValueError("Delivery date must be within database timeline (Sep 2016 to Oct 2018)")
            except ValueError as e:
                if "within database timeline" in str(e):
                    raise
                if clean[:10] < "2016-09-01" or clean[:10] > "2018-10-31":
                    raise ValueError("Delivery date must be within database timeline (Sep 2016 to Oct 2018)")
            return clean
        return v


# ------------------------------------------------------------------------------
# 5. Order Review Blueprint (Review Modal)
# ------------------------------------------------------------------------------
class ReviewIn(BaseModel):
    review_score: int = Field(ge=1, le=5, description="Star rating between 1 and 5")
    review_comment_title: str | None = Field(default="", max_length=128, description="Review headline")
    review_comment_message: str | None = Field(default="", max_length=2000, description="Full customer feedback")
    order_id: str | None = None
    review_creation_date: str | None = None

    @field_validator("review_score")
    @classmethod
    def validate_score(cls, v):
        if v < 1 or v > 5:
            raise ValueError("Review score must be between 1 and 5 stars")
        return v

    @field_validator("review_creation_date")
    @classmethod
    def validate_review_date(cls, v):
        if v:
            clean = v.strip()
            try:
                dt = datetime.fromisoformat(clean.replace("Z", "+00:00"))
                d = dt.date()
                if d < date(2016, 9, 1) or d > date(2018, 10, 31):
                    raise ValueError("Review date must be within database timeline (Sep 2016 to Oct 2018)")
            except ValueError as e:
                if "within database timeline" in str(e):
                    raise
                if clean[:10] < "2016-09-01" or clean[:10] > "2018-10-31":
                    raise ValueError("Review date must be within database timeline (Sep 2016 to Oct 2018)")
            return clean
        return v
