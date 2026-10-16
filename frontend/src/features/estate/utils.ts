import type { DonorGroup, Relation } from "./types";

export const relationLabels: Record<Relation, string> = { spouse: "배우자", child: "자녀", grandchild: "손자녀", parent: "부모", other_relative: "기타친족" };
export const donorLabels: Record<DonorGroup, string> = { parents: "부모", grandparents: "조부모", spouse: "배우자", children: "자녀", relative: "기타친족", non_relative: "친족 아님" };
export const categoryLabels: Record<string, string> = { lineal_ascendant: "직계존속", lineal_descendant: "직계비속", spouse: "배우자", other_relative: "기타친족", none: "공제 없음" };
export const assetLabels: Record<string, string> = { cash: "현금", listed_stock: "상장주식", real_estate: "부동산", other: "기타" };
export const allowedGroups: Record<Relation, DonorGroup[]> = { spouse: ["spouse"], child: ["parents", "grandparents", "relative", "non_relative"], grandchild: ["grandparents", "parents", "relative", "non_relative"], parent: ["children", "relative", "non_relative"], other_relative: ["relative", "non_relative"] };
export function todayKst() { return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul" }).format(new Date()); }
export const excludedAssumptions = [
  "2024년 1월 1일 이전 기록도 현행 규칙으로 다시 계산한 추정치예요.",
  "거주자를 대상으로 입력한 재산 평가액을 그대로 사용합니다. 비거주자·부담부증여·창업자금·가업승계·영농 특례는 제외합니다.",
  "상속인은 배우자와 자녀만 다룹니다. 대습상속·직계존속·형제 상속은 제외합니다.",
  "배우자 상속공제는 단순식입니다. 상속세 세대생략 할증·재해손실·가업·영농상속공제는 제외합니다.",
  "배우자 증여 방향·부동산 증여와 평가·2차 상속·실제 신고서 작성은 다루지 않습니다.",
];
