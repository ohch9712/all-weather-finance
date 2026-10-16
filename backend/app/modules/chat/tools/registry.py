"""챗봇 도구 레지스트리(스펙 09 6절). 15가 모듈 데이터 도구를 여기에 등록한다."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from datetime import date
from typing import TYPE_CHECKING

from pydantic import BaseModel
from sqlalchemy.orm import Session

if TYPE_CHECKING:
    from app.modules.auth.models import User


@dataclass
class ToolContext:
    db: Session
    user: User
    today: date  # today_kst()


@dataclass
class ToolOutput:
    # 모델에 보낼 결과. dict·list는 json.dumps(ensure_ascii=False, sort_keys=True)
    content: str | dict | list
    card: dict | None = None  # 화면 카드(스펙 7절 형식)


@dataclass(frozen=True)
class ToolSpec:
    name: str  # snake_case, 바꾸지 않는다
    description: str  # 모델용 한국어 설명: 언제 쓰는지, 무엇을 돌려주는지
    input_model: type[BaseModel]  # model_config = ConfigDict(extra="forbid")
    label: str  # 화면 상태 문구. 예: "자산배분 확인 중"
    handler: Callable[[ToolContext, BaseModel], ToolOutput]


_TOOLS: dict[str, ToolSpec] = {}


def register_tool(spec: ToolSpec) -> None:
    if spec.name in _TOOLS:
        raise ValueError(f"이미 등록된 도구입니다: {spec.name}")
    _TOOLS[spec.name] = spec


def get_registered_tools() -> list[ToolSpec]:
    """이름순. 도구 목록을 고정해 Gemini 자동 캐시 적중과 테스트 재현성을 지킨다(5.4)."""
    return [_TOOLS[name] for name in sorted(_TOOLS)]


def find_tool(name: str) -> ToolSpec | None:
    return _TOOLS.get(name)
