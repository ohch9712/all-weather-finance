import type { Metadata } from "next";
import Link from "next/link";
import { SearchX } from "lucide-react";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "페이지를 찾을 수 없어요" };

export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 px-4 text-center">
      <SearchX className="size-10 text-muted-foreground" aria-hidden="true" />
      <div className="space-y-1">
        <h1 className="text-xl font-semibold">페이지를 찾을 수 없어요</h1>
        <p className="text-sm text-muted-foreground break-keep">주소가 바뀌었거나 없는 페이지예요. 주소를 다시 확인해 주세요.</p>
      </div>
      <Button asChild>
        <Link href="/">홈으로 가기</Link>
      </Button>
    </main>
  );
}
