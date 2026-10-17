"""설치된 multipart 파서로 파일을 메모리 안에서만 읽는다."""

from dataclasses import dataclass
from io import BytesIO

from fastapi import Request
from python_multipart import MultipartParser
from python_multipart.exceptions import MultipartParseError
from python_multipart.multipart import parse_options_header

from app.core.errors import AppError, field_error


def invalid(field, message):
    raise field_error(field, message)


def too_large():
    return AppError(413, "IMPORT_FILE_TOO_LARGE", "파일 용량이 너무 큽니다.")


@dataclass(frozen=True)
class Upload:
    consent: bool
    file_name: str
    data: bytes


class MemoryUploadParser:
    def __init__(self, maximum: int):
        self.maximum = maximum
        self.fields: dict[str, str] = {}
        self.file = BytesIO()
        self.file_name: str | None = None
        self.complete = False
        self.parts = 0

    def on_part_begin(self):
        self.parts += 1
        if self.parts > 3:
            invalid("file", "파일 업로드 형식이 올바르지 않습니다.")
        self.header_name = bytearray()
        self.header_value = bytearray()
        self.headers: dict[bytes, bytes] = {}
        self.part_name = ""
        self.part_value = bytearray()

    def on_header_field(self, data, start, end):
        self.header_name.extend(data[start:end])

    def on_header_value(self, data, start, end):
        self.header_value.extend(data[start:end])

    def on_header_end(self):
        self.headers[bytes(self.header_name).lower()] = bytes(self.header_value)
        self.header_name.clear()
        self.header_value.clear()

    def on_headers_finished(self):
        _, options = parse_options_header(self.headers.get(b"content-disposition"))
        try:
            self.part_name = options.get(b"name", b"").decode("utf-8")
            if b"filename" in options:
                if self.part_name != "file" or self.file_name is not None:
                    invalid("file", "파일은 한 개씩 올려 주세요.")
                self.file_name = options[b"filename"].decode("utf-8")
            elif self.part_name not in ("consent",) or self.part_name in self.fields:
                invalid("file", "파일 업로드 형식이 올바르지 않습니다.")
        except UnicodeDecodeError:
            invalid("file", "파일 업로드 형식이 올바르지 않습니다.")

    def on_part_data(self, data, start, end):
        if self.part_name == "file":
            if self.file.tell() + end - start > self.maximum:
                raise too_large()
            self.file.write(data[start:end])
        else:
            if len(self.part_value) + end - start > 1024:
                invalid(self.part_name, "입력값을 확인해 주세요.")
            self.part_value.extend(data[start:end])

    def on_part_end(self):
        if self.part_name != "file":
            try:
                self.fields[self.part_name] = self.part_value.decode("utf-8")
            except UnicodeDecodeError:
                invalid(self.part_name, "입력값을 확인해 주세요.")

    def on_end(self):
        self.complete = True


async def read_upload(request: Request) -> Upload:
    media_type, options = parse_options_header(request.headers.get("content-type"))
    boundary = options.get(b"boundary")
    if media_type != b"multipart/form-data" or not boundary or len(boundary) > 200:
        invalid("file", "파일을 multipart/form-data 형식으로 올려 주세요.")
    maximum = 10 * 1024 * 1024
    memory = MemoryUploadParser(maximum)
    callbacks = {
        name: getattr(memory, name)
        for name in (
            "on_part_begin",
            "on_part_data",
            "on_part_end",
            "on_header_field",
            "on_header_value",
            "on_header_end",
            "on_headers_finished",
            "on_end",
        )
    }
    parser = MultipartParser(boundary, callbacks, max_header_count=8, max_header_size=4096)
    total = 0
    try:
        async for chunk in request.stream():
            total += len(chunk)
            if total > maximum + 65536:
                raise too_large()
            parser.write(chunk)
        parser.finalize()
        if not memory.complete:
            invalid("file", "파일 업로드 형식이 올바르지 않습니다.")
        if memory.fields.get("consent") != "true":
            invalid("consent", "AI로 처리하는 데 동의해 주세요.")
        if not memory.file_name:
            invalid("file", "필수 항목입니다.")
        if len(memory.file_name) > 255:
            invalid("file", "파일 이름은 255자 이하로 정해 주세요.")
        return Upload(
            True,
            memory.file_name,
            memory.file.getvalue(),
        )
    except MultipartParseError:
        invalid("file", "파일 업로드 형식이 올바르지 않습니다.")
    finally:
        memory.file.close()
