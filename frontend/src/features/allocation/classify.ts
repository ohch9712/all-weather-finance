import type { AssetClass } from "@/lib/domain";

// 스펙 14 5절. 백엔드 classify.py와 같은 순서·키워드로 표시 근거를 구한다.
export const CLASSIFICATION_RULES: readonly (readonly [AssetClass, readonly string[]])[] = [
  ["cash", ["MMF", "머니마켓", "CD금리", "KOFR", "SOFR", "파킹", "단기자금", "초단기", "BIL", "SGOV"]],
  ["bond", ["채권", "국채", "국고채", "회사채", "단기채", "장기채", "크레딧", "통안채", "국공채", "하이일드", "TREASURY", "BOND", "TLT", "IEF", "SHY", "BND", "AGG"]],
  ["gold", ["골드", "금현물", "금선물", "KRX금", "GOLD", "GLD", "IAU"]],
  ["other", ["리츠", "REIT", "원유", "WTI", "원자재", "구리", "천연가스", "비트코인", "이더리움", "인프라"]],
];

export function classificationReason(name: string): string {
  if (name.startsWith("예수금(")) return "예수금은 현금성 자산으로 분류해요.";
  for (const [, keywords] of CLASSIFICATION_RULES) {
    const keyword = keywords.find((word) => name.toLowerCase().includes(word.toLowerCase()));
    if (keyword) return `종목명의 ‘${keyword}’ 키워드로 자동 분류했어요.`;
  }
  return "분류 키워드가 없어 주식으로 자동 분류했어요.";
}
