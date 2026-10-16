import type { FieldValues, Path, UseFormSetError } from "react-hook-form";
import { ApiError, UNKNOWN_ERROR_MESSAGE } from "./api-client";

// 서버 에러(architecture 4.1)를 폼의 필드 에러와 폼 위 안내 문구로 나눈다.

export interface SubmitErrors<Field extends string> {
  fieldErrors: Partial<Record<Field, string>>;
  formError: string | null;
}

export interface SubmitErrorOptions<Field extends string> {
  /** 필드 없이 오는 에러 코드를 특정 필드에 붙인다. 예: `{ EMAIL_ALREADY_EXISTS: "email" }` */
  codeToField?: Partial<Record<string, Field>>;
}

/**
 * - `VALIDATION_ERROR`: `details[].field`가 폼 필드면 그 아래에, 아니면 폼 위에 보여 준다.
 * - `codeToField`에 있는 코드: 그 필드 아래에 서버 메시지를 보여 준다.
 * - 그 밖의 `ApiError`: 서버 메시지(네트워크·타임아웃 문구 포함)를 폼 위에 보여 준다.
 */
export function toSubmitErrors<Field extends string>(
  error: unknown,
  fields: readonly Field[],
  options: SubmitErrorOptions<Field> = {},
): SubmitErrors<Field> {
  const fieldErrors: Partial<Record<Field, string>> = {};
  if (!(error instanceof ApiError)) {
    return { fieldErrors, formError: UNKNOWN_ERROR_MESSAGE };
  }

  const mappedField = options.codeToField?.[error.code];
  if (mappedField) {
    fieldErrors[mappedField] = error.message;
    return { fieldErrors, formError: null };
  }

  if (error.code === "VALIDATION_ERROR") {
    const isField = (field: string): field is Field => (fields as readonly string[]).includes(field);
    let hasUnmapped = error.details.length === 0;
    for (const detail of error.details) {
      if (isField(detail.field)) {
        fieldErrors[detail.field] ??= detail.message;
      } else {
        hasUnmapped = true;
      }
    }
    // 폼에 없는 필드의 에러는 필드 이름만으로는 위치를 알 수 없으므로 최상위 메시지를 폼 위에 보여 준다.
    return { fieldErrors, formError: hasUnmapped ? error.message || UNKNOWN_ERROR_MESSAGE : null };
  }

  return { fieldErrors, formError: error.message || UNKNOWN_ERROR_MESSAGE };
}

/** `toSubmitErrors`의 필드 에러를 react-hook-form에 넣고 첫 필드로 포커스를 옮긴다. */
export function applyFieldErrors<T extends FieldValues>(
  setError: UseFormSetError<T>,
  fieldErrors: Partial<Record<Path<T>, string>>,
): void {
  Object.entries(fieldErrors).forEach(([field, message], index) => {
    if (typeof message === "string") {
      setError(field as Path<T>, { type: "server", message }, { shouldFocus: index === 0 });
    }
  });
}
