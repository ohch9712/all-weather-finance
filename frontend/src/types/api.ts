// 백엔드 공통 응답 형식(architecture 4절). 필드 이름은 백엔드 camelCase 그대로다.

export interface ErrorDetail {
  field: string;
  message: string;
}

export interface ErrorBody {
  code: string;
  message: string;
  details: ErrorDetail[];
}

export interface ErrorResponse {
  error: ErrorBody;
}

/** 목록 페이지네이션 응답. 요청은 `?page=1&pageSize=20`(최대 100) */
export interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}
