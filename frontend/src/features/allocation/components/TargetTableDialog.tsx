"use client";

import { useState } from "react";
import { Table2 } from "lucide-react";
import { ErrorState } from "@/components/common/ErrorState";
import { LoadingState } from "@/components/common/LoadingState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AGE_BAND_LABEL,
  ASSET_CLASSES,
  ASSET_CLASS_LABEL,
  RISK_PROFILE_LABEL,
  type AgeBand,
  type RiskProfile,
} from "@/lib/domain";
import { cn } from "@/lib/utils";
import { useTargetTable } from "../hooks";

interface TargetTableDialogProps {
  /** 강조할 내 칸 */
  ageBand: AgeBand | null;
  riskProfile: RiskProfile | null;
}

/** 7.5 나이대·성향별 권장 배분표. 좁은 화면에서도 가로 스크롤이 없도록 나이대를 하나씩 고른다. */
export function TargetTableDialog({ ageBand, riskProfile }: TargetTableDialogProps) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<AgeBand | null>(null);
  const table = useTargetTable(open);
  const rows = table.data?.rows ?? [];
  const current = selected ?? ageBand ?? rows[0]?.ageBand ?? null;
  const row = rows.find((item) => item.ageBand === current);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline">
          <Table2 aria-hidden="true" />
          나이대·성향별 표 보기
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>나이대·성향별 권장 배분표</DialogTitle>
          <DialogDescription>
            장기 투자 몫의 기본 비중(%)이에요. 젊을수록, 성향이 공격적일수록 주식 비중이 커져요.
          </DialogDescription>
        </DialogHeader>
        {table.isPending ? (
          <LoadingState rows={4} />
        ) : table.isError ? (
          <ErrorState error={table.error} onRetry={() => table.refetch()} />
        ) : (
          <div className="min-w-0 space-y-3">
            <div role="group" aria-label="나이대 고르기" className="flex flex-wrap gap-1.5">
              {rows.map((item) => (
                <Button
                  key={item.ageBand}
                  type="button"
                  size="sm"
                  variant={item.ageBand === current ? "default" : "outline"}
                  aria-pressed={item.ageBand === current}
                  onClick={() => setSelected(item.ageBand)}
                >
                  {AGE_BAND_LABEL[item.ageBand]}
                </Button>
              ))}
            </div>
            {row && (
              <table className="w-full table-fixed text-xs sm:text-sm">
                <caption className="sr-only">{AGE_BAND_LABEL[row.ageBand]} 성향별 권장 배분(%)</caption>
                <thead>
                  <tr className="border-b text-muted-foreground">
                    <th scope="col" className="w-[30%] py-2 text-left font-medium">
                      성향
                    </th>
                    {ASSET_CLASSES.map((assetClass) => (
                      <th key={assetClass} scope="col" className="py-2 text-right font-medium break-keep">
                        {assetClass === "cash" ? "현금" : ASSET_CLASS_LABEL[assetClass]}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {row.cells.map((cell) => {
                    const mine = row.ageBand === ageBand && cell.riskProfile === riskProfile;
                    return (
                      <tr
                        key={cell.riskProfile}
                        aria-current={mine ? "true" : undefined}
                        className={cn("border-b last:border-0", mine && "bg-primary/10 font-semibold")}
                      >
                        <th scope="row" className="py-2 text-left font-normal break-keep">
                          <span className={cn(mine && "font-semibold")}>{RISK_PROFILE_LABEL[cell.riskProfile]}</span>
                          {mine && (
                            <Badge variant="secondary" className="ml-1 align-middle">
                              내 배분
                            </Badge>
                          )}
                        </th>
                        {ASSET_CLASSES.map((assetClass) => (
                          <td key={assetClass} className="py-2 text-right tabular-nums">
                            {cell.weights[assetClass]}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
