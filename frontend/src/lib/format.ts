// 화면 표시용 형식 함수(스펙 01 11.2). 백엔드 `app/core/format.py`와 같은 규칙이다.
// 금액(원)은 정수, 날짜는 `YYYY-MM-DD`, 시각은 ISO 8601 UTC로 받고 KST로 보여 준다(architecture 4절).

export const KST_TIME_ZONE = "Asia/Seoul";

const integerFormatter = new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 0 });

function groupDigits(value: number): string {
  return integerFormatter.format(value);
}

/** `1234000` → `"1,234,000원"`, `-5000` → `"-5,000원"` */
export function formatKRW(value: number): string {
  const rounded = Math.round(value);
  // -0이 "-0원"으로 보이지 않게 한다.
  return `${groupDigits(rounded === 0 ? 0 : rounded)}원`;
}

/** 양수에 `+`를 붙인다. `5000` → `"+5,000원"`, `-5000` → `"-5,000원"`, `0` → `"0원"` */
export function formatSignedKRW(value: number): string {
  const text = formatKRW(value);
  return Math.round(value) > 0 ? `+${text}` : text;
}

const EOK = 100_000_000;
const MAN = 10_000;

// 정수 나눗셈의 사사오입(ROUND_HALF_UP). 음수가 아닌 정수만 받는다.
function divideHalfUp(value: number, divisor: number): number {
  return Math.floor((value + divisor / 2) / divisor);
}

function formatEok(absValue: number): string {
  // 억 단위 소수 첫째 자리까지. `.0`은 생략한다.
  const tenths = divideHalfUp(absValue, EOK / 10);
  const whole = Math.floor(tenths / 10);
  const decimal = tenths % 10;
  return `${groupDigits(whole)}${decimal === 0 ? "" : `.${decimal}`}억원`;
}

/**
 * 큰 금액을 짧게 보여 준다.
 * - 절댓값 1억 이상: 억 단위 소수 첫째 자리(`123400000` → `"1.2억원"`, `100000000` → `"1억원"`)
 * - 1만 이상: 만 단위 정수(`56700000` → `"5,670만원"`, `12345678` → `"1,235만원"`). 반올림 결과가 1억이면 `"1억원"`
 * - 1만 미만: `formatKRW`
 * - 음수는 앞에 `-`를 붙인다.
 */
export function formatKRWCompact(value: number): string {
  const rounded = Math.round(value);
  const absValue = Math.abs(rounded);
  const sign = rounded < 0 ? "-" : "";
  if (absValue >= EOK) return `${sign}${formatEok(absValue)}`;
  if (absValue >= MAN) {
    const man = divideHalfUp(absValue, MAN);
    if (man >= MAN) return `${sign}${formatEok(man * MAN)}`;
    return `${sign}${groupDigits(man)}만원`;
  }
  return formatKRW(rounded);
}

/** `formatPercent(12.345, 1)` → `"12.3%"`. 소수 자릿수는 `digits`로 고정한다(기본 1). */
export function formatPercent(value: number, digits = 1): string {
  const text = new Intl.NumberFormat("ko-KR", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
    useGrouping: false,
  }).format(value);
  return `${text === `-${(0).toFixed(digits)}` ? (0).toFixed(digits) : text}%`;
}

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

const kstPartsFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: KST_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function toKstParts(value: string | Date) {
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return null;
  const parts = Object.fromEntries(
    kstPartsFormatter.formatToParts(date).map((part) => [part.type, part.value]),
  );
  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour,
    minute: parts.minute,
  };
}

/** `"2026-10-16"` → `"2026.10.16"`. 시각 문자열을 넣으면 KST 날짜로 바꾼다. 해석할 수 없으면 입력을 그대로 돌려준다. */
export function formatDate(value: string | Date): string {
  if (typeof value === "string") {
    const match = DATE_ONLY.exec(value);
    if (match) return `${match[1]}.${match[2]}.${match[3]}`;
  }
  const parts = toKstParts(value);
  if (!parts) return String(value);
  return `${parts.year}.${parts.month}.${parts.day}`;
}

/** `"2026-10-16T03:21:45Z"` → `"2026.10.16 12:21"`(KST). 해석할 수 없으면 입력을 그대로 돌려준다. */
export function formatDateTime(value: string | Date): string {
  const parts = toKstParts(value);
  if (!parts) return String(value);
  return `${parts.year}.${parts.month}.${parts.day} ${parts.hour}:${parts.minute}`;
}

/** KST 기준 올해(출생연도 선택지·나이 계산용) */
export function currentKstYear(now: Date = new Date()): number {
  return Number(toKstParts(now)?.year ?? now.getUTCFullYear());
}
