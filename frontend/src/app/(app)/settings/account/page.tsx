import type { Metadata } from "next";
import { AccountSettings } from "./AccountSettings";

export const metadata: Metadata = { title: "계정" };

export default function AccountSettingsPage() {
  return <AccountSettings />;
}
