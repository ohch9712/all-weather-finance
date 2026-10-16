from typing import TypeVar

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel


class CamelModel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, from_attributes=True)


class ErrorDetail(CamelModel):
    field: str
    message: str


class ErrorBody(CamelModel):
    code: str
    message: str
    details: list[ErrorDetail] = Field(default_factory=list)


class ErrorResponse(CamelModel):
    error: ErrorBody


T = TypeVar("T")


class Page[T](CamelModel):
    items: list[T]
    page: int
    page_size: int
    total: int


class PageParams(CamelModel):
    page: int = Field(default=1, ge=1)
    page_size: int = Field(default=20, ge=1, le=100)
