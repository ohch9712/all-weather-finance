"""학습 게시판 규칙(스펙 07 5절): YouTube 주소, 초성, 슬러그, 오늘의 용어. 모두 순수 함수다."""

import re
import secrets
from datetime import date
from urllib.parse import parse_qs, urlsplit

SLUG_PATTERN = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
# `/learn/glossary` 화면 경로와 겹치는 슬러그는 상세로 갈 수 없다.
RESERVED_SLUGS = frozenset({"glossary"})

VIDEO_ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]{11}$")
WATCH_HOSTS = frozenset({"youtube.com", "www.youtube.com", "m.youtube.com"})
SHORT_HOST = "youtu.be"
EMBED_BASE = "https://www.youtube-nocookie.com/embed/"

# 한글 음절의 첫 자음 19개(유니코드 순서). 쌍자음은 기본 자음으로 묶는다.
CHOSEONG = "ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ"
DOUBLE_TO_BASE = {"ㄲ": "ㄱ", "ㄸ": "ㄷ", "ㅃ": "ㅂ", "ㅆ": "ㅅ", "ㅉ": "ㅈ"}
HANGUL_INITIALS = tuple(c for c in CHOSEONG if c not in DOUBLE_TO_BASE)
LATIN_INITIALS = tuple(chr(code) for code in range(ord("A"), ord("Z") + 1))
OTHER_INITIAL = "#"
INITIALS = (*HANGUL_INITIALS, *LATIN_INITIALS, OTHER_INITIAL)

HANGUL_FIRST, HANGUL_LAST = 0xAC00, 0xD7A3
SYLLABLES_PER_INITIAL = 21 * 28


def auto_slug() -> str:
    return f"p-{secrets.token_hex(4)}"


def is_valid_slug(slug: str) -> bool:
    return bool(SLUG_PATTERN.match(slug)) and slug not in RESERVED_SLUGS


def parse_youtube_id(url: str) -> str | None:
    """허용한 YouTube 주소면 11자 영상 ID, 아니면 None.

    받는 형식: `youtube.com/watch?v=`, `youtu.be/`, `youtube.com/shorts/`,
    `m.youtube.com`(www 포함).
    """
    text = url.strip()
    if "://" not in text:
        text = f"https://{text}"
    try:
        parts = urlsplit(text)
        has_port = parts.port is not None
    except ValueError:
        return None
    if parts.scheme not in ("http", "https") or parts.username or parts.password or has_port:
        return None
    host = (parts.hostname or "").lower()
    segments = [segment for segment in parts.path.split("/") if segment]
    candidate: str | None = None
    if host == SHORT_HOST and len(segments) == 1:
        candidate = segments[0]
    elif host in WATCH_HOSTS:
        if segments == ["watch"]:
            values = parse_qs(parts.query).get("v", [])
            candidate = values[0] if len(values) == 1 else None
        elif len(segments) == 2 and segments[0] == "shorts":
            candidate = segments[1]
    if candidate is None or not VIDEO_ID_PATTERN.match(candidate):
        return None
    return candidate


def embed_url(video_id: str) -> str:
    return f"{EMBED_BASE}{video_id}"


def initial_of(text: str) -> str:
    """한글 음절은 첫 자음(쌍자음은 기본 자음), 영문은 A-Z, 그 밖은 `#`."""
    first = text.strip()[:1]
    if not first:
        return OTHER_INITIAL
    code = ord(first)
    if HANGUL_FIRST <= code <= HANGUL_LAST:
        consonant = CHOSEONG[(code - HANGUL_FIRST) // SYLLABLES_PER_INITIAL]
        return DOUBLE_TO_BASE.get(consonant, consonant)
    if first.isascii() and first.isalpha():
        return first.upper()
    return OTHER_INITIAL


def glossary_sort_key(term: str) -> tuple[int, str]:
    """가나다순: 한글 → 영문(대소문자 무시) → 그 밖."""
    initial = initial_of(term)
    if initial in LATIN_INITIALS:
        group = 1
    elif initial == OTHER_INITIAL:
        group = 2
    else:
        group = 0
    return group, term.strip().casefold()


def term_of_the_day_index(day: date, count: int) -> int:
    """공개 용어를 slug 순으로 정렬했을 때 오늘의 용어 위치."""
    return day.toordinal() % count
