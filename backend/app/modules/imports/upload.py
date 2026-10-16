"""원본 파일이 임시 파일로 넘어가지 않는 메모리 전용 multipart 읽기."""

from dataclasses import dataclass
from email import policy
from email.parser import BytesParser

from fastapi import Request

from app.core.config import get_settings
from app.modules.imports.readers import too_large
from app.modules.imports.validation import invalid


@dataclass(frozen=True)
class Upload:
    kind: str
    file_name: str
    data: bytes
    sheet_name: str | None


async def read_upload(request: Request) -> Upload:
    content_type = request.headers.get("content-type", "")
    if (
        not content_type.lower().startswith("multipart/form-data;")
        or "\r" in content_type
        or "\n" in content_type
    ):
        invalid("file", "파일을 multipart/form-data 형식으로 올려 주세요.")
    maximum = get_settings().import_max_file_mb * 1024 * 1024
    body = bytearray()
    # 파일 외 multipart 헤더·필드도 제한해 요청 전체를 메모리 안에 둔다.
    async for chunk in request.stream():
        if len(body) + len(chunk) > maximum + 65536:
            raise too_large()
        body.extend(chunk)
    message = BytesParser(policy=policy.default).parsebytes(
        f"Content-Type: {content_type}\r\nMIME-Version: 1.0\r\n\r\n".encode() + body
    )
    if not message.is_multipart() or message.defects:
        invalid("file", "파일 업로드 형식이 올바르지 않습니다.")
    fields: dict[str, str] = {}
    data: bytes | None = None
    file_name = ""
    for part in message.iter_parts():
        name = part.get_param("name", header="content-disposition")
        if part.is_multipart() or part.defects:
            invalid("file", "파일 업로드 형식이 올바르지 않습니다.")
        payload = part.get_payload(decode=True) or b""
        if name == "file":
            if data is not None:
                invalid("file", "파일은 한 개씩 올려 주세요.")
            data = payload
            file_name = part.get_filename() or ""
            if len(data) > maximum:
                raise too_large()
        elif name in ("kind", "sheetName"):
            if len(payload) > 1024 or name in fields:
                invalid(name, "입력값을 확인해 주세요.")
            try:
                fields[name] = payload.decode("utf-8")
            except UnicodeDecodeError:
                invalid(name, "입력값을 확인해 주세요.")
    if not fields.get("kind"):
        invalid("kind", "필수 항목입니다.")
    if data is None or not file_name:
        invalid("file", "필수 항목입니다.")
    if len(file_name) > 255:
        invalid("file", "파일 이름은 255자 이하로 정해 주세요.")
    return Upload(fields["kind"], file_name, data, fields.get("sheetName") or None)
