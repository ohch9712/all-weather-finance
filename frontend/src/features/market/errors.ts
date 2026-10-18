import { getErrorMessage, isApiError } from "@/lib/api-client";

// 증권사 오류 코드의 화면 안내. 연결 카드와 토스 계좌 불러오기가 같은 문구를 쓴다(스펙 08 9절).
export const brokerErrors: Record<string, string> = {
  BROKER_AUTH_FAILED: "앱키·시크릿과 계좌 식별값을 확인해 주세요.",
  BROKER_IP_NOT_ALLOWED: "증권사 포털에 이 서버의 IP를 허용 IP로 등록해 주세요.",
  BROKER_RATE_LIMITED: "호출 한도를 초과했습니다. 잠시 후 다시 확인해 주세요.",
  BROKER_UNAVAILABLE: "증권사에 연결하지 못했습니다. 잠시 후 다시 확인해 주세요.",
  BROKER_NOT_SUPPORTED: "이 연결에서는 잔고 조회를 지원하지 않습니다.",
};

export function brokerErrorMessage(error: unknown): string {
  return (isApiError(error) && brokerErrors[error.code]) || getErrorMessage(error);
}
