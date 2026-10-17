"""스펙 14 5절의 순서대로 종목명에서 자산군과 일치 키워드를 찾는다."""

from app.core.domain import AssetClass

CLASSIFICATION_RULES = (
    (
        AssetClass.CASH,
        ("MMF", "머니마켓", "CD금리", "KOFR", "SOFR", "파킹", "단기자금", "초단기", "BIL", "SGOV"),
    ),
    (
        AssetClass.BOND,
        (
            "채권",
            "국채",
            "국고채",
            "회사채",
            "단기채",
            "장기채",
            "크레딧",
            "통안채",
            "국공채",
            "하이일드",
            "TREASURY",
            "BOND",
            "TLT",
            "IEF",
            "SHY",
            "BND",
            "AGG",
        ),
    ),
    (AssetClass.GOLD, ("골드", "금현물", "금선물", "KRX금", "GOLD", "GLD", "IAU")),
    (
        AssetClass.OTHER,
        (
            "리츠",
            "REIT",
            "원유",
            "WTI",
            "원자재",
            "구리",
            "천연가스",
            "비트코인",
            "이더리움",
            "인프라",
        ),
    ),
)


def classify_holding(name: str) -> tuple[AssetClass, str | None]:
    normalized = name.casefold()
    for asset_class, keywords in CLASSIFICATION_RULES:
        for keyword in keywords:
            if keyword.casefold() in normalized:
                return asset_class, keyword
    return AssetClass.STOCK, None
