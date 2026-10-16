import type { Recommendation, Survey, TargetTable } from "@/features/allocation/types";

// 백엔드 순수 함수(recommendation.py)가 만든 실제 응답이다. 스펙 02 5.8 사례 2(오늘 2026-10-16)와 자산 없음 사례.
// 다시 만들 때: backend에서 build_recommendation으로 같은 입력을 넣고 model_dump(by_alias=True, mode="json").

export const SURVEY: Survey = {
  "version": 1,
  "questions": [
    {
      "id": "horizon",
      "text": "이 돈을 얼마 동안 투자할 수 있나요?",
      "options": [
        {
          "value": 1,
          "label": "6개월 미만"
        },
        {
          "value": 2,
          "label": "6개월 ~ 1년"
        },
        {
          "value": 3,
          "label": "1년 ~ 3년"
        },
        {
          "value": 4,
          "label": "3년 ~ 5년"
        },
        {
          "value": 5,
          "label": "5년 이상"
        }
      ]
    },
    {
      "id": "experience",
      "text": "지금까지 투자해 본 상품 중 가장 위험한 것은 무엇인가요?",
      "options": [
        {
          "value": 1,
          "label": "예금·적금만 해 봤어요"
        },
        {
          "value": 2,
          "label": "채권, 채권형 펀드"
        },
        {
          "value": 3,
          "label": "혼합형 펀드, ELS 같은 파생결합증권"
        },
        {
          "value": 4,
          "label": "주식, 주식형 펀드, ETF"
        },
        {
          "value": 5,
          "label": "레버리지·인버스 ETF, 선물·옵션, 신용거래"
        }
      ]
    },
    {
      "id": "knowledge",
      "text": "금융상품에 대해 얼마나 알고 있나요?",
      "options": [
        {
          "value": 1,
          "label": "거의 모른다"
        },
        {
          "value": 2,
          "label": "예금과 펀드의 차이 정도는 안다"
        },
        {
          "value": 3,
          "label": "주식과 채권의 위험 차이를 설명할 수 있다"
        },
        {
          "value": 4,
          "label": "대부분의 금융상품 구조와 위험을 이해한다"
        }
      ]
    },
    {
      "id": "income",
      "text": "앞으로의 수입은 어떨 것 같나요?",
      "options": [
        {
          "value": 1,
          "label": "수입이 없거나 줄어들 것 같다"
        },
        {
          "value": 2,
          "label": "지금은 안정적이지만 앞으로 불안정할 것 같다"
        },
        {
          "value": 3,
          "label": "안정적으로 유지될 것 같다"
        },
        {
          "value": 4,
          "label": "꾸준히 늘어날 것 같다"
        }
      ]
    },
    {
      "id": "investmentRatio",
      "text": "가진 금융자산 중 원금 손실이 날 수 있는 상품에 투자할 비중은 얼마인가요?",
      "options": [
        {
          "value": 1,
          "label": "10% 이하"
        },
        {
          "value": 2,
          "label": "10% ~ 20%"
        },
        {
          "value": 3,
          "label": "20% ~ 30%"
        },
        {
          "value": 4,
          "label": "30% ~ 40%"
        },
        {
          "value": 5,
          "label": "40% 초과"
        }
      ]
    },
    {
      "id": "lossTolerance",
      "text": "투자금이 1년 동안 어느 정도 손실이 나도 견딜 수 있나요?",
      "options": [
        {
          "value": 1,
          "label": "원금은 꼭 지켜야 한다"
        },
        {
          "value": 2,
          "label": "10% 이내"
        },
        {
          "value": 3,
          "label": "20% 이내"
        },
        {
          "value": 4,
          "label": "30% 이내"
        },
        {
          "value": 5,
          "label": "기대 수익이 크다면 그 이상도 괜찮다"
        }
      ]
    }
  ]
};

export const TARGET_TABLE: TargetTable = {
  "rows": [
    {
      "ageBand": "20s",
      "cells": [
        {
          "riskProfile": "stable",
          "weights": {
            "stock": 45,
            "bond": 40,
            "gold": 10,
            "cash": 5,
            "other": 0
          }
        },
        {
          "riskProfile": "stable_seeking",
          "weights": {
            "stock": 60,
            "bond": 30,
            "gold": 5,
            "cash": 5,
            "other": 0
          }
        },
        {
          "riskProfile": "neutral",
          "weights": {
            "stock": 75,
            "bond": 15,
            "gold": 5,
            "cash": 5,
            "other": 0
          }
        },
        {
          "riskProfile": "active",
          "weights": {
            "stock": 80,
            "bond": 5,
            "gold": 5,
            "cash": 5,
            "other": 5
          }
        },
        {
          "riskProfile": "aggressive",
          "weights": {
            "stock": 80,
            "bond": 0,
            "gold": 5,
            "cash": 5,
            "other": 10
          }
        }
      ]
    },
    {
      "ageBand": "30s",
      "cells": [
        {
          "riskProfile": "stable",
          "weights": {
            "stock": 35,
            "bond": 50,
            "gold": 10,
            "cash": 5,
            "other": 0
          }
        },
        {
          "riskProfile": "stable_seeking",
          "weights": {
            "stock": 50,
            "bond": 35,
            "gold": 10,
            "cash": 5,
            "other": 0
          }
        },
        {
          "riskProfile": "neutral",
          "weights": {
            "stock": 65,
            "bond": 25,
            "gold": 5,
            "cash": 5,
            "other": 0
          }
        },
        {
          "riskProfile": "active",
          "weights": {
            "stock": 70,
            "bond": 15,
            "gold": 5,
            "cash": 5,
            "other": 5
          }
        },
        {
          "riskProfile": "aggressive",
          "weights": {
            "stock": 75,
            "bond": 5,
            "gold": 5,
            "cash": 5,
            "other": 10
          }
        }
      ]
    },
    {
      "ageBand": "40s",
      "cells": [
        {
          "riskProfile": "stable",
          "weights": {
            "stock": 25,
            "bond": 55,
            "gold": 10,
            "cash": 10,
            "other": 0
          }
        },
        {
          "riskProfile": "stable_seeking",
          "weights": {
            "stock": 40,
            "bond": 40,
            "gold": 10,
            "cash": 10,
            "other": 0
          }
        },
        {
          "riskProfile": "neutral",
          "weights": {
            "stock": 55,
            "bond": 25,
            "gold": 10,
            "cash": 10,
            "other": 0
          }
        },
        {
          "riskProfile": "active",
          "weights": {
            "stock": 60,
            "bond": 20,
            "gold": 5,
            "cash": 10,
            "other": 5
          }
        },
        {
          "riskProfile": "aggressive",
          "weights": {
            "stock": 65,
            "bond": 10,
            "gold": 5,
            "cash": 10,
            "other": 10
          }
        }
      ]
    },
    {
      "ageBand": "50s",
      "cells": [
        {
          "riskProfile": "stable",
          "weights": {
            "stock": 15,
            "bond": 65,
            "gold": 10,
            "cash": 10,
            "other": 0
          }
        },
        {
          "riskProfile": "stable_seeking",
          "weights": {
            "stock": 30,
            "bond": 50,
            "gold": 10,
            "cash": 10,
            "other": 0
          }
        },
        {
          "riskProfile": "neutral",
          "weights": {
            "stock": 45,
            "bond": 35,
            "gold": 10,
            "cash": 10,
            "other": 0
          }
        },
        {
          "riskProfile": "active",
          "weights": {
            "stock": 50,
            "bond": 25,
            "gold": 10,
            "cash": 10,
            "other": 5
          }
        },
        {
          "riskProfile": "aggressive",
          "weights": {
            "stock": 55,
            "bond": 20,
            "gold": 5,
            "cash": 10,
            "other": 10
          }
        }
      ]
    },
    {
      "ageBand": "60s",
      "cells": [
        {
          "riskProfile": "stable",
          "weights": {
            "stock": 10,
            "bond": 65,
            "gold": 10,
            "cash": 15,
            "other": 0
          }
        },
        {
          "riskProfile": "stable_seeking",
          "weights": {
            "stock": 20,
            "bond": 55,
            "gold": 10,
            "cash": 15,
            "other": 0
          }
        },
        {
          "riskProfile": "neutral",
          "weights": {
            "stock": 35,
            "bond": 40,
            "gold": 10,
            "cash": 15,
            "other": 0
          }
        },
        {
          "riskProfile": "active",
          "weights": {
            "stock": 40,
            "bond": 30,
            "gold": 10,
            "cash": 15,
            "other": 5
          }
        },
        {
          "riskProfile": "aggressive",
          "weights": {
            "stock": 45,
            "bond": 20,
            "gold": 10,
            "cash": 15,
            "other": 10
          }
        }
      ]
    }
  ]
};

export const RECOMMENDATION_APPLIED: Recommendation = {
  "status": "ready",
  "layering": "applied",
  "ageBand": "30s",
  "riskProfile": "neutral",
  "riskScore": 57.8,
  "riskProfileSummary": "수익과 위험의 균형을 원해요.",
  "risky": {
    "start": 65,
    "adjustment": 0,
    "final": 65,
    "clamped": false
  },
  "baseWeights": {
    "stock": 65,
    "bond": 25,
    "gold": 5,
    "cash": 5,
    "other": 0
  },
  "totalAmount": 52000000,
  "layers": {
    "emergency": {
      "monthlyExpense": 2000000,
      "months": 3,
      "targetAmount": 6000000,
      "allocatedAmount": 6000000
    },
    "shortTermGoals": [
      {
        "goalId": "00000000-0000-4000-8000-000000000101",
        "title": "내 집 마련",
        "targetDate": "2028-10-16",
        "horizon": "within_3y",
        "targetAmount": 20000000,
        "allocatedAmount": 20000000,
        "assetClass": "bond"
      }
    ],
    "longTermAmount": 26000000
  },
  "targetAmounts": {
    "stock": 16900000,
    "bond": 26500000,
    "gold": 1300000,
    "cash": 7300000,
    "other": 0
  },
  "targetWeights": {
    "stock": 32.5,
    "bond": 50.96,
    "gold": 2.5,
    "cash": 14.04,
    "other": 0.0
  },
  "directions": [
    {
      "kind": "reserve_short_term_goal",
      "priority": 3,
      "title": "'내 집 마련' 자금은 안전하게",
      "body": "2028년 10월에 쓸 2,000만원은 값이 크게 흔들리지 않는 채권으로 모아 두는 것을 권해요.",
      "amount": 20000000,
      "assetClass": "bond",
      "href": "/allocation/recommendation/detail"
    },
    {
      "kind": "rebalance",
      "priority": 4,
      "title": "채권 비중을 늘려요",
      "body": "지금 채권 비중은 11.5%로 권장 51.0%보다 39.5%p 낮아요. 약 2,050만원을 더 모으면 권장 배분에 가까워져요.",
      "amount": 20500000,
      "assetClass": "bond",
      "href": "/allocation"
    },
    {
      "kind": "rebalance",
      "priority": 4,
      "title": "현금성 자산 비중을 줄여요",
      "body": "지금 현금성 자산 비중은 38.5%로 권장 14.0%보다 24.5%p 높아요. 약 1,270만원을 줄이면 권장 배분에 가까워져요.",
      "amount": 12700000,
      "assetClass": "cash",
      "href": "/allocation"
    },
    {
      "kind": "long_term_goal",
      "priority": 5,
      "title": "'노후 준비'은 장기 투자로 준비해요",
      "body": "2056년 10월까지 시간이 넉넉해서 장기 투자 몫(권장 배분)으로 꾸준히 모으는 방식이 어울려요.",
      "amount": null,
      "assetClass": null,
      "href": "/allocation/recommendation/detail"
    }
  ],
  "reasons": [
    {
      "code": "age_band",
      "title": "나이대: 30대",
      "body": "투자할 수 있는 기간이 길수록 위험자산(주식+기타) 비중을 높게 잡아요. 대표 나이 35세 기준 출발점은 100 − 35 = 65%예요."
    },
    {
      "code": "risk_profile",
      "title": "투자성향: 위험중립형(57.8점)",
      "body": "수익과 위험의 균형을 원해요. 그래서 위험자산 비중을 따로 조정하지 않았어요. 투자 기간은 '1년 ~ 3년', 견딜 수 있는 손실은 '20% 이내'이라고 답했고, 이 두 문항이 점수에 가장 크게 반영돼요. 위험자산 비중은 65%예요."
    },
    {
      "code": "emergency_fund",
      "title": "비상금: 600만원",
      "body": "생활비 200만원의 3개월치를 현금성 자산으로 먼저 떼어 두었어요. 부양가족이 있거나 앞으로 수입이 불안정할 것 같다고 답하면 6개월치로 늘려요."
    },
    {
      "code": "short_term_goals",
      "title": "가까운 목표 자금: 2,000만원",
      "body": "3년 안에 쓸 돈은 값이 크게 흔들리지 않게 1년 안이면 현금성 자산, 1~3년이면 채권으로 잡았어요. '내 집 마련' 2028년 10월 2,000만원(채권)"
    },
    {
      "code": "long_term_mix",
      "title": "장기 투자 몫: 2,600만원",
      "body": "나머지는 나이대·성향 표 비중대로 주식 65% · 채권 25% · 금 5% · 현금성 자산 5% · 기타 0%로 나눴어요."
    }
  ],
  "assetClassNotes": [
    {
      "assetClass": "stock",
      "weight": 32.5,
      "note": "기업의 성장에 투자해요. 오래 둘수록 기대 수익이 크지만 값이 크게 오르내려요."
    },
    {
      "assetClass": "bond",
      "weight": 50.96,
      "note": "정해진 이자를 받으며, 주식이 흔들릴 때 전체 자산의 변동을 줄여 줘요."
    },
    {
      "assetClass": "gold",
      "weight": 2.5,
      "note": "물가가 오르거나 시장이 불안할 때 다른 자산과 다르게 움직여 분산 효과가 있어요."
    },
    {
      "assetClass": "cash",
      "weight": 14.04,
      "note": "비상금과 곧 쓸 돈이에요. 손실 위험은 거의 없지만 물가만큼 불어나기는 어려워요."
    },
    {
      "assetClass": "other",
      "weight": 0.0,
      "note": "리츠·원자재처럼 주식·채권과 다르게 움직이는 자산이에요. 공격적인 성향에서만 조금 담아요."
    }
  ],
  "answerContributions": [
    {
      "questionId": "horizon",
      "question": "이 돈을 얼마 동안 투자할 수 있나요?",
      "answerLabel": "1년 ~ 3년",
      "points": 10.0,
      "maxPoints": 20.0
    },
    {
      "questionId": "experience",
      "question": "지금까지 투자해 본 상품 중 가장 위험한 것은 무엇인가요?",
      "answerLabel": "주식, 주식형 펀드, ETF",
      "points": 10.0,
      "maxPoints": 13.3
    },
    {
      "questionId": "knowledge",
      "question": "금융상품에 대해 얼마나 알고 있나요?",
      "answerLabel": "주식과 채권의 위험 차이를 설명할 수 있다",
      "points": 8.9,
      "maxPoints": 13.3
    },
    {
      "questionId": "income",
      "question": "앞으로의 수입은 어떨 것 같나요?",
      "answerLabel": "안정적으로 유지될 것 같다",
      "points": 8.9,
      "maxPoints": 13.3
    },
    {
      "questionId": "investmentRatio",
      "question": "가진 금융자산 중 원금 손실이 날 수 있는 상품에 투자할 비중은 얼마인가요?",
      "answerLabel": "20% ~ 30%",
      "points": 6.7,
      "maxPoints": 13.3
    },
    {
      "questionId": "lossTolerance",
      "question": "투자금이 1년 동안 어느 정도 손실이 나도 견딜 수 있나요?",
      "answerLabel": "20% 이내",
      "points": 13.3,
      "maxPoints": 26.7
    }
  ]
};

export const RECOMMENDATION_NEEDS_HOLDINGS: Recommendation = {
  "status": "ready",
  "layering": "needs_holdings",
  "ageBand": "30s",
  "riskProfile": "neutral",
  "riskScore": 57.8,
  "riskProfileSummary": "수익과 위험의 균형을 원해요.",
  "risky": {
    "start": 65,
    "adjustment": 0,
    "final": 65,
    "clamped": false
  },
  "baseWeights": {
    "stock": 65,
    "bond": 25,
    "gold": 5,
    "cash": 5,
    "other": 0
  },
  "totalAmount": 0,
  "layers": {
    "emergency": {
      "monthlyExpense": 2000000,
      "months": 3,
      "targetAmount": 6000000,
      "allocatedAmount": null
    },
    "shortTermGoals": [],
    "longTermAmount": null
  },
  "targetAmounts": null,
  "targetWeights": {
    "stock": 65.0,
    "bond": 25.0,
    "gold": 5.0,
    "cash": 5.0,
    "other": 0.0
  },
  "directions": [
    {
      "kind": "build_emergency_fund",
      "priority": 2,
      "title": "비상금을 먼저 채워요",
      "body": "생활비 200만원의 3개월치인 600만원을 비상금으로 먼저 모아 두세요.",
      "amount": 6000000,
      "assetClass": "cash",
      "href": "/allocation/assets"
    },
    {
      "kind": "input_holdings",
      "priority": 6,
      "title": "보유 자산을 입력해 주세요",
      "body": "자산을 입력하면 배분 점수와 조정할 금액을 알려 드려요.",
      "amount": null,
      "assetClass": null,
      "href": "/allocation/assets"
    }
  ],
  "reasons": [
    {
      "code": "age_band",
      "title": "나이대: 30대",
      "body": "투자할 수 있는 기간이 길수록 위험자산(주식+기타) 비중을 높게 잡아요. 대표 나이 35세 기준 출발점은 100 − 35 = 65%예요."
    },
    {
      "code": "risk_profile",
      "title": "투자성향: 위험중립형(57.8점)",
      "body": "수익과 위험의 균형을 원해요. 그래서 위험자산 비중을 따로 조정하지 않았어요. 투자 기간은 '1년 ~ 3년', 견딜 수 있는 손실은 '20% 이내'이라고 답했고, 이 두 문항이 점수에 가장 크게 반영돼요. 위험자산 비중은 65%예요."
    },
    {
      "code": "emergency_fund",
      "title": "비상금: 600만원",
      "body": "생활비 200만원의 3개월치를 현금성 자산으로 먼저 떼어 두었어요. 부양가족이 있거나 앞으로 수입이 불안정할 것 같다고 답하면 6개월치로 늘려요."
    },
    {
      "code": "long_term_mix",
      "title": "장기 투자 비중",
      "body": "자산을 입력하면 비상금과 가까운 목표 자금을 뺀 나머지를 이 비중으로 나눠요: 주식 65% · 채권 25% · 금 5% · 현금성 자산 5% · 기타 0%."
    }
  ],
  "assetClassNotes": [
    {
      "assetClass": "stock",
      "weight": 65.0,
      "note": "기업의 성장에 투자해요. 오래 둘수록 기대 수익이 크지만 값이 크게 오르내려요."
    },
    {
      "assetClass": "bond",
      "weight": 25.0,
      "note": "정해진 이자를 받으며, 주식이 흔들릴 때 전체 자산의 변동을 줄여 줘요."
    },
    {
      "assetClass": "gold",
      "weight": 5.0,
      "note": "물가가 오르거나 시장이 불안할 때 다른 자산과 다르게 움직여 분산 효과가 있어요."
    },
    {
      "assetClass": "cash",
      "weight": 5.0,
      "note": "비상금과 곧 쓸 돈이에요. 손실 위험은 거의 없지만 물가만큼 불어나기는 어려워요."
    },
    {
      "assetClass": "other",
      "weight": 0.0,
      "note": "리츠·원자재처럼 주식·채권과 다르게 움직이는 자산이에요. 공격적인 성향에서만 조금 담아요."
    }
  ],
  "answerContributions": [
    {
      "questionId": "horizon",
      "question": "이 돈을 얼마 동안 투자할 수 있나요?",
      "answerLabel": "1년 ~ 3년",
      "points": 10.0,
      "maxPoints": 20.0
    },
    {
      "questionId": "experience",
      "question": "지금까지 투자해 본 상품 중 가장 위험한 것은 무엇인가요?",
      "answerLabel": "주식, 주식형 펀드, ETF",
      "points": 10.0,
      "maxPoints": 13.3
    },
    {
      "questionId": "knowledge",
      "question": "금융상품에 대해 얼마나 알고 있나요?",
      "answerLabel": "주식과 채권의 위험 차이를 설명할 수 있다",
      "points": 8.9,
      "maxPoints": 13.3
    },
    {
      "questionId": "income",
      "question": "앞으로의 수입은 어떨 것 같나요?",
      "answerLabel": "안정적으로 유지될 것 같다",
      "points": 8.9,
      "maxPoints": 13.3
    },
    {
      "questionId": "investmentRatio",
      "question": "가진 금융자산 중 원금 손실이 날 수 있는 상품에 투자할 비중은 얼마인가요?",
      "answerLabel": "20% ~ 30%",
      "points": 6.7,
      "maxPoints": 13.3
    },
    {
      "questionId": "lossTolerance",
      "question": "투자금이 1년 동안 어느 정도 손실이 나도 견딜 수 있나요?",
      "answerLabel": "20% 이내",
      "points": 13.3,
      "maxPoints": 26.7
    }
  ]
};

export const RECOMMENDATION_NEEDS_PROFILE: Recommendation = {
  "status": "needs_profile",
  "layering": null,
  "ageBand": null,
  "riskProfile": null,
  "riskScore": null,
  "riskProfileSummary": null,
  "risky": null,
  "baseWeights": null,
  "totalAmount": null,
  "layers": null,
  "targetAmounts": null,
  "targetWeights": null,
  "directions": [],
  "reasons": [],
  "assetClassNotes": [],
  "answerContributions": []
};

export const RECOMMENDATION_NEEDS_ASSESSMENT: Recommendation = { ...RECOMMENDATION_NEEDS_PROFILE, status: "needs_assessment" };
