"""도구 레지스트리·기본 도구·시스템 프롬프트(스펙 09 5.6·6·7절)."""

import dataclasses
import importlib
import inspect
import json
import re
from datetime import date

import pytest
from freezegun import freeze_time
from pydantic import BaseModel, ConfigDict

from app.integrations.llm.schema import portable_json_schema
from app.modules.chat import prompts
from app.modules.chat.tools import registry
from app.modules.chat.tools.basic import get_my_profile, get_today
from app.modules.chat.tools.registry import (
    ToolContext,
    ToolOutput,
    ToolSpec,
    get_registered_tools,
    register_tool,
)
from tests.chat.conftest import ALL_TOOL_NAMES, user_by_email


class NoInput(BaseModel):
    model_config = ConfigDict(extra="forbid")


def handler(ctx, params):
    return ToolOutput("ok")


def test_registry_signatures():
    assert [f.name for f in dataclasses.fields(ToolSpec)] == [
        "name",
        "description",
        "input_model",
        "label",
        "handler",
    ]
    assert [f.name for f in dataclasses.fields(ToolContext)] == ["db", "user", "today"]
    assert [f.name for f in dataclasses.fields(ToolOutput)] == ["content", "card"]
    assert ToolOutput("x").card is None
    assert list(inspect.signature(register_tool).parameters) == ["spec"]
    assert list(inspect.signature(get_registered_tools).parameters) == []


def test_register_duplicate_name_is_value_error(temp_tool):
    temp_tool(ToolSpec("aaa_temp", "임시", NoInput, "임시 확인 중", handler))
    with pytest.raises(ValueError):
        register_tool(ToolSpec("aaa_temp", "임시", NoInput, "임시 확인 중", handler))
    with pytest.raises(ValueError):
        register_tool(ToolSpec("get_today", "중복", NoInput, "중복", handler))


def test_tools_are_sorted_by_name(temp_tool):
    temp_tool(ToolSpec("zzz_temp", "임시", NoInput, "임시", handler))
    temp_tool(ToolSpec("aaa_temp", "임시", NoInput, "임시", handler))
    tool_names = [tool.name for tool in get_registered_tools()]
    assert tool_names == sorted(tool_names)
    assert tool_names == sorted(["aaa_temp", "zzz_temp", *ALL_TOOL_NAMES])


def test_default_tools():
    tools = {tool.name: tool for tool in get_registered_tools()}
    assert set(tools) >= {"get_today", "get_my_profile"}
    for tool in tools.values():
        assert re.fullmatch(r"[a-z][a-z0-9_]*", tool.name)
        assert tool.input_model.model_config.get("extra") == "forbid"
        assert tool.description and tool.label
    for name in ("get_today", "get_my_profile"):
        assert portable_json_schema(tools[name].input_model) == {
            "type": "object",
            "properties": {},
            "additionalProperties": False,
            "required": [],
        }


@pytest.mark.parametrize(
    "day,weekday", [(date(2026, 10, 16), "금요일"), (date(2026, 10, 18), "일요일")]
)
def test_get_today(db, day, weekday):
    output = get_today(ToolContext(db=db, user=None, today=day), NoInput())
    assert output.content == {
        "today": day.isoformat(),
        "weekday": weekday,
        "timezone": "Asia/Seoul",
    }
    assert output.card is None


@freeze_time("2026-10-16 03:00:00")
def test_get_my_profile(auth_client, db):
    auth_client.put("/api/profile", json={"birthYear": 1994, "nickname": "감자"})
    user = user_by_email(db)
    output = get_my_profile(ToolContext(db=db, user=user, today=date(2026, 10, 16)), NoInput())
    assert output.content == {
        "birthYear": 1994,
        "age": 32,
        "ageBand": "30s",
        "ageBandLabel": "30대",
        "nickname": "감자",
    }
    # 이메일·ID는 모델에 보내지 않는다.
    serialized = json.dumps(output.content, ensure_ascii=False)
    assert user.email not in serialized and str(user.id) not in serialized
    assert output.card == {
        "type": "key_value",
        "title": "내 프로필",
        "items": [
            {"label": "나이대", "value": "30대"},
            {"label": "나이", "value": "32세"},
            {"label": "출생연도", "value": "1994년"},
            {"label": "닉네임", "value": "감자"},
        ],
    }


def test_system_prompt_is_fixed():
    with freeze_time("2026-10-16 09:00:00"):
        first = importlib.reload(prompts).SYSTEM_PROMPT
    with freeze_time("2031-01-02 23:59:00"):
        second = importlib.reload(prompts).SYSTEM_PROMPT
    assert first.encode() == second.encode()
    assert not re.search(r"\d{4}", first)  # 날짜 같은 가변 값이 없다


@pytest.mark.parametrize(
    "phrase",
    [
        "한국어",
        "쉬운 말로 짧게",
        "Markdown",
        "반드시 도구로 확인",
        "추측하지 않는다",
        "도구 결과에 있는 값만",
        "단위(원, %)",
        "get_today",
        "사라거나 팔라고 권하지 않는다",
        "판단은 사용자에게",
        "주문, 이체, 결제는 할 수 없다",
        "세무 전문가와 상담",
        "모르는 것은 모른다",
    ],
)
def test_system_prompt_covers_rules(phrase):
    assert phrase in prompts.SYSTEM_PROMPT


def test_registry_module_keeps_private_store():
    assert isinstance(registry._TOOLS, dict)
