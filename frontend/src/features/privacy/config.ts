// 처리방침의 운영자 정보(스펙 19 5.1). 공개 저장소에 개인 연락처를 넣지 않도록 서버 환경변수에서 읽는다.
// 이 값은 서버 컴포넌트에서만 읽는다. 브라우저 번들에 넣지 않으려고 NEXT_PUBLIC_ 이름을 쓰지 않는다.

export interface PrivacyValues {
  operatorName: string | null;
  officerName: string | null;
  contactEmail: string | null;
  hostingProvider: string | null;
  /** `YYYY-MM-DD`. 형식이 맞지 않으면 null(미설정)로 본다. */
  effectiveDate: string | null;
}

export const PRIVACY_ENV_KEYS = {
  operatorName: "PRIVACY_OPERATOR_NAME",
  officerName: "PRIVACY_OFFICER_NAME",
  contactEmail: "PRIVACY_CONTACT_EMAIL",
  hostingProvider: "PRIVACY_HOSTING_PROVIDER",
  effectiveDate: "PRIVACY_EFFECTIVE_DATE",
} as const satisfies Record<keyof PrivacyValues, string>;

export const UNSET_TEXT = "(미설정)";

function text(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function isoDate(value: string | undefined): string | null {
  const trimmed = text(value);
  if (!trimmed || !/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null;
  // 2026-02-30처럼 달력에 없는 날짜도 미설정으로 본다.
  const date = new Date(`${trimmed}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === trimmed ? trimmed : null;
}

/** 요청 때(서버) 환경변수에서 운영자 정보를 읽는다. 빈 값은 null이다. */
export function readPrivacyValues(env: Record<string, string | undefined>): PrivacyValues {
  return {
    operatorName: text(env[PRIVACY_ENV_KEYS.operatorName]),
    officerName: text(env[PRIVACY_ENV_KEYS.officerName]),
    contactEmail: text(env[PRIVACY_ENV_KEYS.contactEmail]),
    hostingProvider: text(env[PRIVACY_ENV_KEYS.hostingProvider]),
    effectiveDate: isoDate(env[PRIVACY_ENV_KEYS.effectiveDate]),
  };
}

export function hasMissingValues(values: PrivacyValues): boolean {
  return Object.values(values).some((value) => value === null);
}
