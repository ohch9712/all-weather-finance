from datetime import date, datetime
from typing import Literal
from uuid import UUID

from pydantic import Field, SecretStr, field_validator

from app.core.schemas import CamelModel

Kind = Literal["card", "bank"]


class Provider(CamelModel):
    key: Literal["codef", "mydata"]
    available: bool
    environment: str | None = None
    note: str


class ProviderList(CamelModel):
    items: list[Provider]


class Organization(CamelModel):
    code: str
    name: str


class OrganizationList(CamelModel):
    items: list[Organization]


class AccountInput(CamelModel):
    provider: Literal["codef", "mydata"]
    kind: Kind
    organization: str = Field(min_length=1, max_length=8)
    label: str = Field(min_length=1, max_length=30)
    login_id: SecretStr = Field(min_length=1, max_length=200, repr=False)
    password: SecretStr = Field(min_length=1, max_length=200, repr=False)
    consent: bool = False

    @field_validator("label")
    @classmethod
    def nonblank_label(cls, value):
        if not value.strip():
            raise ValueError("별칭을 입력해 주세요.")
        return value.strip()


class Account(CamelModel):
    id: UUID
    provider: Literal["codef"]
    kind: Kind
    organization: str
    organization_name: str
    label: str
    created_at: datetime


class AccountList(CamelModel):
    items: list[Account]


class SyncInput(CamelModel):
    account_id: UUID
    range_start: date | None = Field(default=None, alias="from")
    range_end: date | None = Field(default=None, alias="to")


class Sync(CamelModel):
    id: UUID
    account_id: UUID
    kind: Literal["card_approvals", "bank_balances"]
    status: Literal["running", "succeeded", "failed"]
    range_start: date | None
    range_end: date | None
    started_at: datetime
    finished_at: datetime | None
    summary: dict | None
    error_code: str | None
