import { z } from "zod";

// 클라이언트 검증(스펙 01 7.3·7.7). 서버와 같은 규칙이고, 최종 판정은 서버가 한다.

export const authMessages = {
  email: "올바른 이메일 형식이 아닙니다.",
  passwordRequired: "비밀번호를 입력해 주세요.",
  password: "비밀번호는 8~128자로 입력해 주세요.",
  passwordMismatch: "비밀번호가 일치하지 않습니다.",
  passwordConfirmRequired: "비밀번호를 한 번 더 입력해 주세요.",
  ageConfirmRequired: "만 14세 이상만 가입할 수 있습니다.",
} as const;

export const profileMessages = {
  birthYearRequired: "출생연도를 선택해 주세요.",
  birthYear: "출생연도를 확인해 주세요.",
  nickname: "닉네임은 20자 이내로 입력해 주세요.",
} as const;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// 백엔드(Python len)와 같게 UTF-16 코드 유닛이 아니라 문자(코드 포인트) 수로 센다.
export function charLength(value: string): number {
  return Array.from(value).length;
}

function isValidEmail(value: string): boolean {
  const trimmed = value.trim();
  const length = charLength(trimmed);
  return length >= 1 && length <= 254 && EMAIL_PATTERN.test(trimmed);
}

function isValidPassword(value: string): boolean {
  const length = charLength(value);
  return length >= 8 && length <= 128;
}

export const loginSchema = z.object({
  email: z.string().refine(isValidEmail, authMessages.email),
  password: z.string().min(1, authMessages.passwordRequired),
});
export type LoginValues = z.infer<typeof loginSchema>;

export const signupSchema = z
  .object({
    email: z.string().refine(isValidEmail, authMessages.email),
    password: z.string().refine(isValidPassword, authMessages.password),
    passwordConfirm: z.string(),
    // "만 14세 이상입니다." 필수 확인(스펙 19 5.2). 서버로 보내지 않는다(서버는 출생연도로 검사한다).
    ageConfirmed: z.boolean().refine((value) => value, authMessages.ageConfirmRequired),
  })
  .superRefine((values, ctx) => {
    if (values.passwordConfirm === "") {
      ctx.addIssue({ code: "custom", path: ["passwordConfirm"], message: authMessages.passwordConfirmRequired });
      return;
    }
    // 비밀번호 자체가 규칙을 어기면 불일치 검사는 하지 않는다(백엔드 7.3과 같다).
    if (isValidPassword(values.password) && values.password !== values.passwordConfirm) {
      ctx.addIssue({ code: "custom", path: ["passwordConfirm"], message: authMessages.passwordMismatch });
    }
  });
export type SignupValues = z.infer<typeof signupSchema>;

export const deleteAccountSchema = z.object({
  password: z.string().min(1, authMessages.passwordRequired),
});
export type DeleteAccountValues = z.infer<typeof deleteAccountSchema>;

export const MIN_BIRTH_YEAR = 1920;

/** 출생연도 선택지: (올해 − 10)부터 1920까지 내림차순 */
export function getBirthYearOptions(currentYear: number): number[] {
  const years: number[] = [];
  for (let year = currentYear - 10; year >= MIN_BIRTH_YEAR; year -= 1) years.push(year);
  return years;
}

/** 폼 값은 문자열(Select 값)로 받고, 저장할 때 정수·null로 바꾼다. */
export function createProfileSchema(currentYear: number) {
  const maxYear = currentYear - 10;
  return z.object({
    birthYear: z
      .string()
      .min(1, profileMessages.birthYearRequired)
      .refine((value) => {
        const year = Number(value);
        return Number.isInteger(year) && year >= MIN_BIRTH_YEAR && year <= maxYear;
      }, profileMessages.birthYear)
      .transform(Number),
    nickname: z
      .string()
      .transform((value) => value.trim())
      .refine((value) => charLength(value) <= 20, profileMessages.nickname)
      .transform((value) => (value === "" ? null : value)),
  });
}
export type ProfileFormInput = z.input<ReturnType<typeof createProfileSchema>>;
export type ProfileFormOutput = z.output<ReturnType<typeof createProfileSchema>>;
