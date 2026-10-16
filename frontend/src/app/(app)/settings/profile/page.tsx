import type { Metadata } from "next";
import { ProfileSettings } from "./ProfileSettings";

export const metadata: Metadata = { title: "프로필 설정" };

export default function ProfileSettingsPage() {
  return <ProfileSettings />;
}
