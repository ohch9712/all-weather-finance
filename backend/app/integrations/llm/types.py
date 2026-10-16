from dataclasses import dataclass
from typing import Literal

Effort = Literal["low", "medium", "high"]
DataClass = Literal["general", "personal"]
ProviderName = Literal["gemini", "ollama"]


@dataclass(frozen=True)
class TextPart:
    text: str


@dataclass(frozen=True)
class ImagePart:
    data: bytes
    mime_type: Literal["image/png", "image/jpeg", "image/webp"]


@dataclass(frozen=True)
class DocumentPart:
    data: bytes
    mime_type: Literal["application/pdf"] = "application/pdf"


Part = TextPart | ImagePart | DocumentPart
