import type { Metadata } from "next";
import { OnboardingForm } from "./OnboardingForm";

export const metadata: Metadata = { title: "기본 정보 입력" };

export default function OnboardingPage() {
  return <OnboardingForm />;
}
