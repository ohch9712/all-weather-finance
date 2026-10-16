"""기본 도구 get_today, get_my_profile(스펙 09 6절)."""

from pydantic import BaseModel, ConfigDict

from app.core.domain import AGE_BAND_LABEL
from app.modules.auth import service as auth_service
from app.modules.chat.tools.registry import ToolContext, ToolOutput, ToolSpec, register_tool

WEEKDAYS = ("월요일", "화요일", "수요일", "목요일", "금요일", "토요일", "일요일")
TIMEZONE = "Asia/Seoul"


class NoInput(BaseModel):
    model_config = ConfigDict(extra="forbid")


def get_today(ctx: ToolContext, params: BaseModel) -> ToolOutput:
    return ToolOutput(
        {
            "today": ctx.today.isoformat(),
            "weekday": WEEKDAYS[ctx.today.weekday()],
            "timezone": TIMEZONE,
        }
    )


def get_my_profile(ctx: ToolContext, params: BaseModel) -> ToolOutput:
    # 01의 공개 서비스 함수. 이메일·ID는 모델에 보내지 않는다.
    profile = auth_service.get_profile(ctx.db, ctx.user.id)
    band = profile.age_band
    label = AGE_BAND_LABEL[band] if band is not None else None
    items = [
        {"label": "나이대", "value": label or "미입력"},
        {"label": "나이", "value": f"{profile.age}세" if profile.age is not None else "미입력"},
        {
            "label": "출생연도",
            "value": f"{profile.birth_year}년" if profile.birth_year is not None else "미입력",
        },
    ]
    if profile.nickname:
        items.append({"label": "닉네임", "value": profile.nickname})
    return ToolOutput(
        {
            "birthYear": profile.birth_year,
            "age": profile.age,
            "ageBand": band.value if band is not None else None,
            "ageBandLabel": label,
            "nickname": profile.nickname,
        },
        card={"type": "key_value", "title": "내 프로필", "items": items},
    )


register_tool(
    ToolSpec(
        name="get_today",
        description=(
            "오늘 날짜(한국 시간)를 알려 준다. 날짜·요일·기간 계산이 필요할 때 쓴다. "
            "today(YYYY-MM-DD), weekday(요일), timezone을 돌려준다."
        ),
        input_model=NoInput,
        label="오늘 날짜 확인 중",
        handler=get_today,
    )
)
register_tool(
    ToolSpec(
        name="get_my_profile",
        description=(
            "사용자의 출생연도, 나이, 나이대, 닉네임을 확인한다. 나이나 나이대에 맞는 설명이 "
            "필요할 때 쓴다. birthYear, age, ageBand(20s~60s), ageBandLabel, nickname을 돌려준다. "
            "입력하지 않은 값은 null이다."
        ),
        input_model=NoInput,
        label="프로필 확인 중",
        handler=get_my_profile,
    )
)
