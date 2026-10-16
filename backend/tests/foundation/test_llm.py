import base64
import json
from enum import StrEnum
from io import BytesIO
from typing import Annotated, Literal
from unittest.mock import Mock

import httpx
import pypdfium2 as pdfium
import pytest
from google.genai.interactions import Interaction
from ollama import ChatResponse, ResponseError
from PIL import Image
from pydantic import BaseModel, Field

from app.core.config import Settings
from app.core.errors import AppError
from app.integrations.llm import clients, gemini_adapter, ollama_adapter, status
from app.integrations.llm.fake import FakeStructuredLLM
from app.integrations.llm.gemini_adapter import GeminiStructuredLLM
from app.integrations.llm.ollama_adapter import OllamaStructuredLLM
from app.integrations.llm.pdf import pdf_to_png_pages
from app.integrations.llm.schema import portable_json_schema
from app.integrations.llm.structured import DisabledLLM, RoutedStructuredLLM
from app.integrations.llm.tasks import LLM_TASKS, get_task
from app.integrations.llm.types import DocumentPart, ImagePart, TextPart


class Output(BaseModel):
    value: int


@pytest.fixture
def settings():
    return Settings(
        gemini_api_key="fake-key",
        gemini_billing_enabled=True,
        llm_general_provider="gemini",
        llm_personal_provider="ollama",
        gemini_model="test-gemini-model",
        ollama_model="test-ollama-model",
    )


@pytest.fixture
def pdf_bytes():
    with pdfium.PdfDocument.new() as document:
        document.new_page(100, 120).close()
        document.new_page(120, 100).close()
        result = BytesIO()
        document.save(result)
    return result.getvalue()


def test_pdf_pages(pdf_bytes):
    pages = pdf_to_png_pages(pdf_bytes)
    assert len(pages) == 2
    for page, size in zip(pages, [(200, 240), (240, 200)], strict=True):
        with Image.open(BytesIO(page)) as image:
            assert image.format == "PNG"
            assert image.size == size
    for invalid in [b"invalid", b"%PDF-invalid"]:
        with pytest.raises(ValueError):
            pdf_to_png_pages(invalid)


def test_portable_schema():
    class Choice(StrEnum):
        FIRST = "first"
        SECOND = "second"

    class Child(BaseModel):
        number: int = Field(ge=1, le=100, multiple_of=2)
        text: str = Field(min_length=1, max_length=20, pattern="a", examples=["a"])

    class Cat(BaseModel):
        kind: Literal["cat"]
        name: str

    class Dog(BaseModel):
        kind: Literal["dog"]
        age: int

    class Model(BaseModel):
        child: Child
        optional: Child | None = None
        choice: Choice
        pet: Annotated[Cat | Dog, Field(discriminator="kind")]
        email: str = Field(json_schema_extra={"format": "email"})
        items: list[str] = Field(min_length=1, max_length=2)

    schema = portable_json_schema(Model)
    serialized = json.dumps(schema)
    for forbidden in [
        "$defs",
        "$ref",
        "oneOf",
        "discriminator",
        "const",
        "title",
        "default",
        "examples",
        "minLength",
        "maxLength",
        "pattern",
        "minimum",
        "maximum",
        "multipleOf",
        "minItems",
        "maxItems",
        'email"}',
    ]:
        assert f'"{forbidden}"' not in serialized
    assert schema["additionalProperties"] is False
    assert set(schema["required"]) == set(schema["properties"])
    assert {"type": "null"} in schema["properties"]["optional"]["anyOf"]
    assert schema["properties"]["child"]["required"] == ["number", "text"]
    assert schema["properties"]["choice"]["enum"] == ["first", "second"]
    assert schema["properties"]["pet"]["anyOf"][0]["properties"]["kind"]["enum"] == ["cat"]
    assert "format" not in schema["properties"]["email"]


def test_schema_recursive_and_dates():
    from datetime import date, datetime

    class Recursive(BaseModel):
        child: "Recursive | None" = None

    with pytest.raises(ValueError, match="재귀"):
        portable_json_schema(Recursive)

    class Dates(BaseModel):
        day: date
        at: datetime

    schema = portable_json_schema(Dates)
    assert schema["properties"]["day"]["format"] == "date"
    assert schema["properties"]["at"]["format"] == "date-time"


def test_routing(settings, monkeypatch):
    monkeypatch.setattr(status, "get_settings", lambda: settings)
    gemini = Mock()
    ollama = Mock()
    monkeypatch.setattr(gemini_adapter, "GeminiStructuredLLM", lambda: gemini)
    monkeypatch.setattr(ollama_adapter, "OllamaStructuredLLM", lambda: ollama)
    llm = RoutedStructuredLLM()
    assert llm.enabled_for("screener.parse")
    assert llm.enabled_for("imports.column_mapping")
    for key in LLM_TASKS:
        llm.generate(task=key, system="시스템", content="입력", output=Output)
    assert gemini.generate.call_count == 2
    assert ollama.generate.call_count == 4
    assert {call.kwargs["task"] for call in ollama.generate.call_args_list} == {
        key for key, task in LLM_TASKS.items() if task.data_class == "personal"
    }
    with pytest.raises(ValueError):
        llm.enabled_for("unregistered")
    with pytest.raises(ValueError):
        llm.generate(task="unregistered", system="", content="", output=Output)


@pytest.mark.parametrize(
    "general,personal,key,billing,reasons",
    [
        ("disabled", "disabled", "", False, ("not_configured", "not_configured")),
        ("gemini", "gemini", "", False, ("missing_api_key", "missing_api_key")),
        ("gemini", "gemini", "fake-key", False, (None, "billing_required")),
        ("gemini", "gemini", "fake-key", True, (None, None)),
        ("ollama", "ollama", "", False, (None, None)),
    ],
)
def test_status_and_billing(auth_client, monkeypatch, general, personal, key, billing, reasons):
    config = Settings(
        llm_general_provider=general,
        llm_personal_provider=personal,
        gemini_api_key=key,
        gemini_billing_enabled=billing,
    )
    monkeypatch.setattr(status, "get_settings", lambda: config)
    response = auth_client.get("/api/ai/status")
    assert response.status_code == 200
    assert (response.json()["general"]["reason"], response.json()["personal"]["reason"]) == reasons
    for scope, provider, reason in zip(
        ["general", "personal"], [general, personal], reasons, strict=True
    ):
        item = response.json()[scope]
        assert item["enabled"] == (reason is None)
        assert item["provider"] == (None if provider == "disabled" else provider)
        assert item["location"] == (
            None if provider == "disabled" else "cloud" if provider == "gemini" else "local"
        )
        assert item["model"] == (
            None
            if provider == "disabled"
            else config.gemini_model
            if provider == "gemini"
            else config.ollama_model
        )
        task = "screener.parse" if scope == "general" else "chat.agent"
        assert RoutedStructuredLLM().enabled_for(task) == item["enabled"]
        if reason:
            with pytest.raises(AppError) as exc:
                RoutedStructuredLLM().generate(task=task, system="", content="", output=Output)
            assert exc.value.code == "LLM_UNAVAILABLE"
    assert "fake-key" not in response.text
    assert "127.0.0.1" not in response.text


def test_disabled_and_fake(fake_llm):
    with pytest.raises(AppError) as exc:
        DisabledLLM().generate(task="chat.agent", system="", content="", output=Output)
    assert exc.value.status_code == 503
    assert not DisabledLLM().enabled_for("chat.agent")
    fake_llm.register("screener.parse", lambda request: {"value": 3})
    assert (
        fake_llm.generate(
            task="screener.parse", system="시스템", content="입력", output=Output
        ).value
        == 3
    )
    assert fake_llm.calls[0].data_class == "general"
    assert fake_llm.calls[0].content == [TextPart("입력")]
    assert fake_llm.calls[0].output_name == "Output"
    with pytest.raises(AssertionError):
        FakeStructuredLLM().generate(task="chat.agent", system="", content=[], output=Output)
    fake_llm.set_enabled("screener.parse", False)
    assert not fake_llm.enabled_for("screener.parse")
    with pytest.raises(AppError):
        fake_llm.generate(task="screener.parse", system="", content="", output=Output)


def gemini_client(status="completed", text='{"value":1}'):
    client = Mock()
    # google-genai 2.31 interaction.py의 _populate_output_helpers가 steps에서 계산한다.
    client.interactions.create.return_value = Interaction.model_validate(
        {
            "id": "test",
            "status": status,
            "steps": [{"type": "model_output", "content": [{"type": "text", "text": text}]}],
        }
    )
    return client


def test_gemini_call_arguments(settings, pdf_bytes):
    client = gemini_client()
    llm = GeminiStructuredLLM(client, settings)
    result = llm.generate(
        task="ledger.extract_statement",
        system="지침",
        content=[
            TextPart("앞"),
            ImagePart(b"image", "image/png"),
            DocumentPart(pdf_bytes),
            TextPart("뒤"),
        ],
        output=Output,
    )
    assert result.value == 1
    args = client.interactions.create.call_args.kwargs
    assert args["model"] == settings.gemini_model
    assert args["store"] is False
    assert args["system_instruction"] == "지침"
    assert args["generation_config"] == {"thinking_level": "medium", "max_output_tokens": 16000}
    assert args["response_format"] == {
        "type": "text",
        "mime_type": "application/json",
        "schema": portable_json_schema(Output),
    }
    assert args["input"] == [
        {"type": "image", "data": base64.b64encode(b"image").decode(), "mime_type": "image/png"},
        {
            "type": "document",
            "data": base64.b64encode(pdf_bytes).decode(),
            "mime_type": "application/pdf",
        },
        {"type": "text", "text": "앞\n뒤"},
    ]
    assert not {"temperature", "top_p", "tools", "tool_choice"} & set(args)


def test_gemini_direct_calls_enforce_privacy_and_missing_key(settings):
    client = gemini_client()
    settings.gemini_billing_enabled = False
    llm = GeminiStructuredLLM(client, settings)
    assert not llm.enabled_for("chat.agent")
    with pytest.raises(AppError) as exc:
        llm.generate(task="chat.agent", system="", content="개인 데이터", output=Output)
    assert exc.value.status_code == 503
    client.interactions.create.assert_not_called()
    settings.gemini_api_key = ""
    with pytest.raises(AppError):
        llm.generate(task="screener.parse", system="", content="일반 입력", output=Output)
    client.interactions.create.assert_not_called()


@pytest.mark.parametrize(
    "response_status,text,substring",
    [
        ("incomplete", "invalid", "너무 길어"),
        ("failed", "invalid", "받지 못했습니다"),
        ("completed", "invalid", "형식이 올바르지"),
    ],
)
def test_gemini_response_errors(settings, response_status, text, substring):
    llm = GeminiStructuredLLM(gemini_client(response_status, text), settings)
    with pytest.raises(AppError) as exc:
        llm.generate(task="screener.parse", system="", content="입력", output=Output)
    assert exc.value.code == "LLM_UNAVAILABLE"
    assert substring in exc.value.message


@pytest.mark.parametrize(
    "code,nested",
    [
        ("safety", True),
        ("jailbreak", False),
        ("prohibited_content", True),
        ("blocklist", False),
        ("other", True),
    ],
)
def test_gemini_sdk_errors(settings, code, nested):
    class SDKError(Exception):
        status_code = 400
        body = {"error": {"code": code}} if nested else {"code": code}

    client = gemini_client()
    client.interactions.create.side_effect = SDKError("비공개 원문")
    with pytest.raises(AppError) as exc:
        GeminiStructuredLLM(client, settings).generate(
            task="screener.parse", system="", content="", output=Output
        )
    assert exc.value.code == ("LLM_UNAVAILABLE" if code == "other" else "LLM_REFUSED")
    client.interactions.create.side_effect = TimeoutError()
    with pytest.raises(AppError) as exc:
        GeminiStructuredLLM(client, settings).generate(
            task="screener.parse", system="", content="", output=Output
        )
    assert exc.value.status_code == 503


def ollama_client(reason="stop", text='{"value":2}'):
    client = Mock()
    client.chat.return_value = ChatResponse(
        done=True, done_reason=reason, message={"role": "assistant", "content": text}
    )
    return client


@pytest.mark.parametrize(
    "task,think", [("imports.column_mapping", False), ("ledger.extract_statement", True)]
)
def test_ollama_call_arguments(settings, pdf_bytes, task, think):
    client = ollama_client()
    llm = OllamaStructuredLLM(client, settings)
    assert (
        llm.generate(
            task=task,
            system="지침",
            content=[TextPart("입력"), ImagePart(b"image", "image/png"), DocumentPart(pdf_bytes)],
            output=Output,
        ).value
        == 2
    )
    args = client.chat.call_args.kwargs
    assert args["model"] == settings.ollama_model
    assert args["messages"][0] == {"role": "system", "content": "지침"}
    assert args["messages"][1]["role"] == "user"
    assert args["messages"][1]["content"] == "입력"
    images = args["messages"][1]["images"]
    assert images[0] == b"image"
    assert len(images) == 3 and images[1].startswith(b"\x89PNG")
    assert args["format"] == portable_json_schema(Output)
    assert args["stream"] is False
    assert args["think"] is think
    assert args["options"] == {
        "temperature": 0,
        "num_predict": get_task(task).max_tokens,
        "num_ctx": settings.ollama_num_ctx,
    }
    settings.ollama_thinking = False
    llm.generate(task=task, system="", content="텍스트", output=Output)
    args = client.chat.call_args.kwargs
    assert "think" not in args
    assert "images" not in args["messages"][1]


@pytest.mark.parametrize(
    "reason,text,substring",
    [("length", "invalid", "너무 길어"), ("stop", "invalid", "형식이 올바르지")],
)
def test_ollama_response_errors(settings, reason, text, substring):
    with pytest.raises(AppError) as exc:
        OllamaStructuredLLM(ollama_client(reason, text), settings).generate(
            task="chat.agent", system="", content="", output=Output
        )
    assert exc.value.status_code == 503
    assert substring in exc.value.message


@pytest.mark.parametrize(
    "error,substring",
    [
        (ConnectionError(), "연결하지 못했습니다"),
        (ResponseError("model missing", 404), "ollama pull"),
        (ResponseError("failure", 500), "받지 못했습니다"),
        (httpx.ReadTimeout("timeout"), "받지 못했습니다"),
    ],
)
def test_ollama_sdk_errors(settings, error, substring):
    client = ollama_client()
    client.chat.side_effect = error
    with pytest.raises(AppError) as exc:
        OllamaStructuredLLM(client, settings).generate(
            task="chat.agent", system="", content="", output=Output
        )
    assert exc.value.code == "LLM_UNAVAILABLE"
    assert substring in exc.value.message


def test_client_factories(settings, monkeypatch):
    clients.get_gemini_client.cache_clear()
    clients.get_ollama_client.cache_clear()
    monkeypatch.setattr(clients, "get_settings", lambda: settings)
    gemini = Mock()
    ollama = Mock()
    monkeypatch.setattr(clients.genai, "Client", gemini)
    monkeypatch.setattr(clients.ollama, "Client", ollama)
    assert clients.get_gemini_client() is clients.get_gemini_client()
    assert clients.get_ollama_client() is clients.get_ollama_client()
    gemini.assert_called_once_with(
        api_key="fake-key", http_options={"timeout": settings.gemini_timeout_seconds * 1000}
    )
    ollama.assert_called_once_with(
        host=settings.ollama_host, timeout=settings.ollama_timeout_seconds
    )
    clients.get_gemini_client.cache_clear()
    clients.get_ollama_client.cache_clear()
