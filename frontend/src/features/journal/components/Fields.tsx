import type { ReactNode } from "react";
import { Label } from "@/components/ui/label";
export function Field({ label, children, error }: { label: string; children: ReactNode; error?: string }) {
  return <div className="min-w-0 space-y-1.5"><Label className="flex flex-col items-stretch gap-1.5">{label}{children}</Label>{error && <p role="alert" className="text-sm text-destructive">{error}</p>}</div>;
}
export const selectClass = "h-9 w-full min-w-0 rounded-lg border border-input bg-background px-2 text-sm";
