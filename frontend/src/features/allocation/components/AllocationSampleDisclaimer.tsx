"use client";

import { Disclaimer } from "@/components/common/Disclaimer";
import { useHoldings } from "../hooks";

/** 배분 계산에 포함된 Mock 자산이 있는 화면의 샘플 고지. */
export function AllocationSampleDisclaimer() {
  const holdings = useHoldings();
  const hasSample = holdings.data?.some((holding) => holding.source === "mock" && holding.includeInAllocation);

  return hasSample ? <Disclaimer variant="sample" /> : null;
}
