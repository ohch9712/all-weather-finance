import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { APP_DESCRIPTION, APP_NAME } from "@/lib/site";
import { Providers } from "./providers";
import "./globals.css";

// 글꼴은 globals.css의 시스템 한글 글꼴 스택(--font-sans)을 쓴다. 빌드할 때 글꼴을 내려받지 않는다.

export const metadata: Metadata = {
  title: { default: APP_NAME, template: `%s | ${APP_NAME}` },
  description: APP_DESCRIPTION,
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ko">
      <body className="min-h-dvh">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
