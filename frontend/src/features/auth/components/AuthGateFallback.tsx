import { Skeleton } from "@/components/ui/skeleton";

/** 로그인 상태를 확인하거나 다른 화면으로 옮기는 동안 앱 셸 자리에 보여 주는 전체 화면 Skeleton */
export function AuthGateFallback({ label = "로그인 상태를 확인하고 있어요" }: { label?: string }) {
  return (
    <div role="status" aria-label={label} className="flex min-h-dvh">
      <div className="hidden w-60 shrink-0 flex-col gap-3 border-r p-5 lg:flex">
        <Skeleton className="h-6 w-32" />
        {Array.from({ length: 8 }, (_, index) => (
          <Skeleton key={index} className="h-8 w-full" />
        ))}
      </div>
      <div className="flex flex-1 flex-col">
        <div className="flex h-14 items-center justify-between border-b px-4 lg:px-8">
          <Skeleton className="h-5 w-24" />
          <Skeleton className="size-8 rounded-full" />
        </div>
        <div className="mx-auto w-full max-w-[1200px] space-y-4 px-4 py-6 lg:px-8">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      </div>
      <span className="sr-only">{label}</span>
    </div>
  );
}
