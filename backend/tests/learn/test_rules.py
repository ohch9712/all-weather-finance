from datetime import date

import pytest

from app.modules.learn import rules


@pytest.mark.parametrize(
    ("text", "initial"),
    [
        ("가치", "ㄱ"),
        ("까치", "ㄱ"),
        ("떡볶이", "ㄷ"),
        ("빵", "ㅂ"),
        ("쌀", "ㅅ"),
        ("짜장", "ㅈ"),
        ("호가", "ㅎ"),
        ("힣", "ㅎ"),
        ("주식", "ㅈ"),
        ("ETF", "E"),
        ("per", "P"),
        ("  roe", "R"),
        ("3배 레버리지", "#"),
        ("100", "#"),
        ("ㄱ", "#"),
        ("é", "#"),
        ("", "#"),
    ],
)
def test_initial_of(text, initial):
    assert rules.initial_of(text) == initial


def test_initials_index_bar_order():
    assert rules.INITIALS[:14] == tuple("ㄱㄴㄷㄹㅁㅂㅅㅇㅈㅊㅋㅌㅍㅎ")
    assert rules.INITIALS[14:40] == tuple("ABCDEFGHIJKLMNOPQRSTUVWXYZ")
    assert rules.INITIALS[-1] == "#"


def test_glossary_sort_key_orders_hangul_latin_other():
    terms = ["ROE", "주식", "3배", "ETF", "가치", "per", "호가"]
    assert sorted(terms, key=rules.glossary_sort_key) == [
        "가치",
        "주식",
        "호가",
        "ETF",
        "per",
        "ROE",
        "3배",
    ]


def test_term_of_the_day_index_is_deterministic():
    day = date(2026, 10, 17)
    assert rules.term_of_the_day_index(day, 30) == day.toordinal() % 30
    assert rules.term_of_the_day_index(day, 30) == rules.term_of_the_day_index(day, 30)
    next_day = date(2026, 10, 18)
    assert rules.term_of_the_day_index(next_day, 30) == (day.toordinal() + 1) % 30


@pytest.mark.parametrize(
    "url",
    [
        "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        "https://youtube.com/watch?v=dQw4w9WgXcQ&t=30s",
        "https://youtu.be/dQw4w9WgXcQ",
        "https://youtu.be/dQw4w9WgXcQ?si=abc",
        "https://www.youtube.com/shorts/dQw4w9WgXcQ",
        "https://m.youtube.com/watch?v=dQw4w9WgXcQ",
        "http://youtube.com/watch?v=dQw4w9WgXcQ",
        "youtube.com/watch?v=dQw4w9WgXcQ",
        "  https://YOUTU.BE/dQw4w9WgXcQ  ",
    ],
)
def test_parse_youtube_id_accepts(url):
    assert rules.parse_youtube_id(url) == "dQw4w9WgXcQ"


def test_parse_youtube_id_keeps_dash_and_underscore():
    assert rules.parse_youtube_id("https://youtu.be/a-b_c-d_e-f") == "a-b_c-d_e-f"


@pytest.mark.parametrize(
    "url",
    [
        "https://vimeo.com/123456789",
        "https://www.youtube.com.evil.com/watch?v=dQw4w9WgXcQ",
        "https://notyoutube.com/watch?v=dQw4w9WgXcQ",
        "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
        "https://www.youtube.com/embed/dQw4w9WgXcQ",
        "https://www.youtube.com/watch?v=short",
        "https://www.youtube.com/watch?v=dQw4w9WgXcQx",
        "https://www.youtube.com/watch",
        "https://www.youtube.com/watch?v=dQw4w9WgXcQ&v=dQw4w9WgXcQ",
        "https://youtu.be/dQw4w9WgXcQ/extra",
        "https://youtu.be/",
        "javascript:alert(1)",
        "ftp://youtube.com/watch?v=dQw4w9WgXcQ",
        "https://youtube.com:8080/watch?v=dQw4w9WgXcQ",
        "https://user@youtube.com/watch?v=dQw4w9WgXcQ",
        "https://www.youtube.com/watch?v=dQw4w9WgX%3C",
        "",
    ],
)
def test_parse_youtube_id_rejects(url):
    assert rules.parse_youtube_id(url) is None


def test_embed_url_uses_nocookie_domain():
    assert rules.embed_url("dQw4w9WgXcQ") == "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"


@pytest.mark.parametrize(
    ("slug", "valid"),
    [
        ("per", True),
        ("index-fund", True),
        ("p-1a2b3c4d", True),
        ("abc123", True),
        ("Per", False),
        ("per_ratio", False),
        ("-per", False),
        ("per-", False),
        ("per--ratio", False),
        ("주식", False),
        ("", False),
        ("glossary", False),
    ],
)
def test_is_valid_slug(slug, valid):
    assert rules.is_valid_slug(slug) is valid


def test_auto_slug_format():
    slug = rules.auto_slug()
    assert len(slug) == 10 and slug.startswith("p-")
    assert rules.is_valid_slug(slug)
