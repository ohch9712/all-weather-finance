"use client";

import type { ReactNode } from "react";
import { DonutChart } from "@/components/charts/DonutChart";
import { assetColor } from "@/components/charts/palette";
import { ASSET_CLASSES, ASSET_CLASS_LABEL } from "@/lib/domain";
import { formatKRWCompact, formatPercent } from "@/lib/format";
import type { ByAssetClass } from "../types";

interface AllocationDonutProps {
  /** 자산군별 값. 금액(`unit="amount"`)이나 비중(`unit="percent"`) */
  values: ByAssetClass<number>;
  unit: "amount" | "percent";
  ariaLabel: string;
  centerLabel?: ReactNode;
  /** 범례에 금액을 붙인다(목표 반영 권장 금액) */
  legendAmounts?: ByAssetClass<number> | null;
}

/** 자산군 5개 도넛. 색은 `--asset-*` 토큰이다. */
export function AllocationDonut({ values, unit, ariaLabel, centerLabel, legendAmounts }: AllocationDonutProps) {
  const data = ASSET_CLASSES.map((assetClass) => ({
    key: assetClass,
    label: legendAmounts
      ? `${ASSET_CLASS_LABEL[assetClass]} ${formatKRWCompact(legendAmounts[assetClass])}`
      : ASSET_CLASS_LABEL[assetClass],
    value: values[assetClass],
    color: assetColor(assetClass),
  }));
  return (
    <DonutChart
      data={data}
      ariaLabel={ariaLabel}
      centerLabel={centerLabel}
      valueFormatter={unit === "amount" ? formatKRWCompact : (value) => formatPercent(value, 1)}
    />
  );
}
