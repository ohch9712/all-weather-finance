"use client";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  FIELD_LABELS,
  OP_LABELS,
  type Condition,
  type ScreenFilter,
} from "../types";
import { conditionLabel, filterSchema } from "../utils";
import { ScopeSelector } from "./ScopeSelector";

const selectClass =
  "h-9 w-full min-w-0 rounded-md border bg-background px-2 text-sm";
type KindOption = "stock" | "etf" | "all";
// kinds가 없으면 전체 범위는 주식만, 관심종목 범위는 주식·ETF 모두다(4.0).
function kindOption(filter: ScreenFilter): KindOption {
  if (!filter.kinds) return filter.universe === "watchlist" ? "all" : "stock";
  if (filter.kinds.length === 2) return "all";
  return filter.kinds[0];
}
function kindsFor(
  option: KindOption,
  filter: ScreenFilter,
): ScreenFilter["kinds"] {
  const watchlist = filter.universe === "watchlist";
  if (option === "etf") return ["etf"];
  if (option === "all") return watchlist ? null : ["stock", "etf"];
  return watchlist ? ["stock"] : null;
}
function Editor({
  condition,
  onSave,
  onCancel,
}: {
  condition: Condition;
  onSave: (c: Condition) => void;
  onCancel: () => void;
}) {
  const { register, handleSubmit, control } = useForm<Condition>({
    defaultValues: condition,
  });
  const op = useWatch({ control, name: "op" });
  const [error, setError] = useState("");
  return (
    <form
      className="grid min-w-0 gap-3 rounded-lg border p-3 sm:grid-cols-2"
      onSubmit={handleSubmit((values) => {
        const result = filterSchema.safeParse({
          conditions: [
            {
              ...values,
              valueTo: values.op === "between" ? values.valueTo : null,
            },
          ],
        });
        if (!result.success) {
          setError("필드·연산자·숫자와 범위의 끝값을 확인해 주세요.");
          return;
        }
        onSave(result.data.conditions[0]);
      })}
    >
      <label className="min-w-0 space-y-1 text-sm">
        필드
        <select
          aria-label="필드"
          className={selectClass}
          {...register("field")}
        >
          {Object.entries(FIELD_LABELS).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label className="min-w-0 space-y-1 text-sm">
        연산자
        <select aria-label="연산자" className={selectClass} {...register("op")}>
          {Object.entries(OP_LABELS).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label className="min-w-0 space-y-1 text-sm">
        값<Input aria-label="값" inputMode="decimal" {...register("value")} />
      </label>
      {op === "between" && (
        <label className="min-w-0 space-y-1 text-sm">
          끝값
          <Input
            aria-label="끝값"
            inputMode="decimal"
            {...register("valueTo")}
          />
        </label>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive sm:col-span-2">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm">
          조건 적용
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={onCancel}>
          취소
        </Button>
      </div>
    </form>
  );
}
export function ConditionEditor({
  filter,
  onChange,
}: {
  filter: ScreenFilter;
  onChange: (f: ScreenFilter) => void;
}) {
  const [editing, setEditing] = useState<number | null>(null);
  return (
    <div className="space-y-4">
      <ScopeSelector filter={filter} onChange={onChange} />
      <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-3">
        <label className="min-w-0 space-y-1 text-sm">
          종류
          <select
            aria-label="종류"
            className={selectClass}
            value={kindOption(filter)}
            onChange={(event) =>
              onChange({
                ...filter,
                kinds: kindsFor(event.target.value as KindOption, filter),
              })
            }
          >
            <option value="stock">주식</option>
            <option value="etf">ETF</option>
            <option value="all">주식·ETF</option>
          </select>
        </label>
        <label className="min-w-0 space-y-1 text-sm">
          시장
          <select
            aria-label="시장"
            className={selectClass}
            value={filter.markets?.length === 1 ? filter.markets[0] : "all"}
            onChange={(event) =>
              onChange({
                ...filter,
                markets:
                  event.target.value === "all"
                    ? null
                    : [event.target.value as "KOSPI" | "KOSDAQ"],
              })
            }
          >
            <option value="all">전체 시장</option>
            <option value="KOSPI">코스피</option>
            <option value="KOSDAQ">코스닥</option>
          </select>
        </label>
        <label className="min-w-0 space-y-1 text-sm">
          최대 결과 수
          <Input
            aria-label="최대 결과 수"
            type="number"
            min={1}
            max={100}
            value={filter.limit}
            onChange={(e) =>
              onChange({
                ...filter,
                limit: Math.max(1, Math.min(100, Number(e.target.value) || 1)),
              })
            }
          />
        </label>
      </div>
      <label className="block space-y-1 text-sm">
        업종(정확한 이름, 쉼표로 구분)
        <Input
          aria-label="업종"
          value={filter.sectors?.join(",") ?? ""}
          onChange={(e) =>
            onChange({
              ...filter,
              sectors: e.target.value ? e.target.value.split(",") : null,
            })
          }
        />
      </label>
      <div className="flex flex-wrap gap-2" aria-label="조건 칩">
        {filter.universe === "watchlist" && (
          <span className="max-w-full break-all rounded-full border px-3 py-1 text-sm">
            {filter.watchlistGroup
              ? `관심종목: ${filter.watchlistGroup}`
              : "관심종목"}
          </span>
        )}
        {filter.kinds?.includes("etf") && (
          <span className="rounded-full border px-3 py-1 text-sm">
            {filter.kinds.length === 2 ? "주식·ETF" : "ETF"}
          </span>
        )}
        {filter.markets?.map((market) => (
          <span key={market} className="rounded-full border px-3 py-1 text-sm">
            {market === "KOSPI" ? "코스피" : "코스닥"}
          </span>
        ))}
        {filter.sectors?.map((sector, index) => (
          <span
            key={index}
            className="max-w-full break-all rounded-full border px-3 py-1 text-sm"
          >
            {sector}
          </span>
        ))}
        {filter.conditions.map((condition, index) => (
          <div
            key={index}
            className="flex max-w-full items-center rounded-full border pl-3 text-sm"
          >
            <button
              type="button"
              className="min-w-0 break-all py-1 text-left"
              onClick={() => setEditing(index)}
              aria-label={`${conditionLabel(condition)} 수정`}
            >
              {conditionLabel(condition)}
            </button>
            <button
              className="shrink-0 px-3 py-1"
              type="button"
              aria-label={`조건 ${index + 1} 삭제`}
              onClick={() => {
                onChange({
                  ...filter,
                  conditions: filter.conditions.filter((_, i) => i !== index),
                });
                setEditing(null);
              }}
            >
              ×
            </button>
          </div>
        ))}
      </div>
      {editing !== null && (
        <Editor
          key={editing}
          condition={
            filter.conditions[editing] ?? {
              field: "per",
              op: "lte",
              value: "10",
              valueTo: null,
            }
          }
          onCancel={() => setEditing(null)}
          onSave={(condition) => {
            const conditions = [...filter.conditions];
            conditions[editing] = condition;
            onChange({ ...filter, conditions });
            setEditing(null);
          }}
        />
      )}
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={filter.conditions.length >= 10}
        onClick={() => setEditing(filter.conditions.length)}
      >
        직접 조건 추가
      </Button>
      <p className="text-xs text-muted-foreground">
        조건은 모두 만족해야 해요. ETF의 재무지표 등 제공되지 않는 값이 있으면
        해당 종목은 제외돼요.
      </p>
    </div>
  );
}
