// 도메인 공통 상수(architecture 6절). 백엔드 `app/core/domain.py`와 같은 값이다.

export const ASSET_CLASSES = ["stock", "bond", "gold", "cash", "other"] as const;
export type AssetClass = (typeof ASSET_CLASSES)[number];

export const ASSET_CLASS_LABEL: Record<AssetClass, string> = {
  stock: "주식",
  bond: "채권",
  gold: "금",
  cash: "현금성 자산",
  other: "기타",
};

/** 자산군 색 토큰(`globals.css`). 차트에는 `var(--asset-stock)`처럼 넘긴다(`components/charts/palette.ts`). */
export const ASSET_CLASS_COLOR_VAR: Record<AssetClass, string> = {
  stock: "--asset-stock",
  bond: "--asset-bond",
  gold: "--asset-gold",
  cash: "--asset-cash",
  other: "--asset-other",
};

export const RISK_PROFILES = ["stable", "stable_seeking", "neutral", "active", "aggressive"] as const;
export type RiskProfile = (typeof RISK_PROFILES)[number];

export const RISK_PROFILE_LABEL: Record<RiskProfile, string> = {
  stable: "안정형",
  stable_seeking: "안정추구형",
  neutral: "위험중립형",
  active: "적극투자형",
  aggressive: "공격투자형",
};

export const AGE_BANDS = ["20s", "30s", "40s", "50s", "60s"] as const;
export type AgeBand = (typeof AGE_BANDS)[number];

// 화면용 짧은 이름이다. 20s는 20세 미만도 포함하고, 60s는 60세 이상 전부다.
export const AGE_BAND_LABEL: Record<AgeBand, string> = {
  "20s": "20대",
  "30s": "30대",
  "40s": "40대",
  "50s": "50대",
  "60s": "60대 이상",
};
