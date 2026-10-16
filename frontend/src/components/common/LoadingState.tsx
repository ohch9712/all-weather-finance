import { Skeleton } from "@/components/ui/skeleton";

interface LoadingStateProps {
  rows?: number;
}

export function LoadingState({ rows = 3 }: LoadingStateProps) {
  return (
    <div role="status" aria-label="불러오는 중" className="space-y-3">
      <Skeleton className="h-6 w-1/3" />
      {Array.from({ length: rows }, (_, index) => (
        <Skeleton key={index} className="h-12 w-full" />
      ))}
      <span className="sr-only">불러오는 중</span>
    </div>
  );
}
