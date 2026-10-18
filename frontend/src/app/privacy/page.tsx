import type { Metadata } from "next";
import { connection } from "next/server";
import { PrivacyPolicy } from "@/features/privacy/components/PrivacyPolicy";
import { readPrivacyValues } from "@/features/privacy/config";

export const metadata: Metadata = { title: "개인정보 처리방침" };

/**
 * 로그인 없이 보는 공개 화면(앱 셸 밖). 운영자 정보는 빌드에 굳히지 않고 요청 때 서버 환경변수에서 읽는다.
 * `connection()` 뒤의 코드는 요청 시에만 실행된다(Next.js 16 환경변수 가이드의 "Runtime Environment Variables").
 */
export default async function PrivacyPage() {
  await connection();
  return <PrivacyPolicy values={readPrivacyValues(process.env)} />;
}
