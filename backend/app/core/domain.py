from enum import StrEnum


class AssetClass(StrEnum):
    STOCK = "stock"
    BOND = "bond"
    GOLD = "gold"
    CASH = "cash"
    OTHER = "other"


class RiskProfile(StrEnum):
    STABLE = "stable"
    STABLE_SEEKING = "stable_seeking"
    NEUTRAL = "neutral"
    ACTIVE = "active"
    AGGRESSIVE = "aggressive"


class AgeBand(StrEnum):
    TWENTIES = "20s"
    THIRTIES = "30s"
    FORTIES = "40s"
    FIFTIES = "50s"
    SIXTIES = "60s"


ASSET_CLASS_LABEL = dict(
    zip(AssetClass, ["주식", "채권", "금", "현금성 자산", "기타"], strict=True)
)
RISK_PROFILE_LABEL = dict(
    zip(
        RiskProfile, ["안정형", "안정추구형", "위험중립형", "적극투자형", "공격투자형"], strict=True
    )
)
AGE_BAND_LABEL = dict(zip(AgeBand, ["20대", "30대", "40대", "50대", "60대 이상"], strict=True))
AGE_BAND_REPRESENTATIVE_AGE = {"20s": 25, "30s": 35, "40s": 45, "50s": 55, "60s": 65}
