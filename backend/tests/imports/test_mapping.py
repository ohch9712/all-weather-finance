import json
from dataclasses import replace

import pytest
from fastapi.exceptions import RequestValidationError

from app.core.errors import AppError
from app.integrations.llm.fake import FakeStructuredLLM
from app.integrations.llm.structured import DisabledLLM
from app.modules.imports.mapping import AI_WARNING, TASK, find_header, suggest
from app.modules.imports.registry import (
    ImportPreset,
    get_import_kind,
    list_import_kinds,
    register_import_kind,
)


def test_registry(demo_kind):
    assert get_import_kind("demo") == demo_kind
    assert list_import_kinds() == [demo_kind]
    with pytest.raises(ValueError):
        register_import_kind(demo_kind)
    with pytest.raises(RequestValidationError):
        get_import_kind("unknown")


def test_preset_synonym_priority(demo_kind):
    header = ["날짜", "금액", "제목", "분류"]
    assert suggest(header, [], demo_kind, DisabledLLM(), [])[0] == {
        "date": 0,
        "amount": 1,
        "title": 2,
        "category": 3,
    }
    preset = ImportPreset(
        "demo_format",
        "가짜 형식",
        tuple(header),
        {"amount": "제목", "title": "금액", "date": "날짜"},
    )
    mapping, source = suggest(header, [], replace(demo_kind, presets=(preset,)), DisabledLLM(), [])
    assert source == "preset"
    assert (mapping["amount"], mapping["title"]) == (2, 1)


def test_llm_sanitization_mask_and_sample_limit(demo_kind):
    fake = FakeStructuredLLM()
    fake.register(
        TASK,
        lambda _: {
            "headerRow": None,
            "mappings": [
                {"field": "date", "columnIndex": 9, "reason": ""},
                {"field": "unknown", "columnIndex": 1, "reason": ""},
                {"field": "date", "columnIndex": 0, "reason": ""},
                {"field": "amount", "columnIndex": 0, "reason": ""},
                {"field": "amount", "columnIndex": 1, "reason": ""},
                {"field": "title", "columnIndex": 2, "reason": ""},
            ],
        },
    )
    mapping, source = suggest(
        ["A", "B", "C"], [["20261016", "123456789012", "제목"]] * 4, demo_kind, fake, []
    )
    assert mapping == {"date": 0, "amount": 1, "title": 2, "category": None}
    assert source == "llm"
    call = fake.calls[0]
    assert call.task == TASK and call.data_class == "personal"
    content = json.loads(call.content[0].text)
    assert len(content["samples"]) == 3
    assert content["samples"][0][:2] == ["20****16", "12********12"]


@pytest.mark.parametrize("code", ["LLM_UNAVAILABLE", "LLM_REFUSED"])
def test_disabled_failure(demo_kind, code):
    fake = FakeStructuredLLM()

    def error(_):
        raise AppError(503, code, "실패")

    fake.register(TASK, error)
    warnings = []
    assert suggest(["날짜", "금액", "알수없음"], [], demo_kind, fake, warnings)[1] == "synonym"
    assert warnings == [AI_WARNING]
    fake.set_enabled(TASK, False)
    assert suggest(["날짜", "금액", "알수없음"], [], demo_kind, fake, [])[1] == "synonym"


def test_header_candidates(demo_kind):
    table = [["안내"], ["날짜 *", "금액(원)", "제목"], ["날짜", "금액", "제목"]]
    assert find_header(table, demo_kind, DisabledLLM(), [])[0] == 1
    fake = FakeStructuredLLM()
    fake.register(TASK, lambda _: {"headerRow": 2, "mappings": []})
    assert find_header([["안내"], ["A", "B", "C"]], demo_kind, fake, [])[0] == 1
    fake.register(TASK, lambda _: {"headerRow": 20, "mappings": []})
    assert find_header([["안내"]], demo_kind, fake, [])[0] is None
