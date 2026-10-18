"use client";

import { useState, type ReactNode } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { z } from "zod";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/features/auth/AuthProvider";
import { createQueryClient } from "@/lib/query";

// CSP에서 Zod JIT 탐지의 Function 호출이 eval 차단 이벤트를 내므로 끈다.
z.config({ jitless: true });

export function Providers({ children }: { children: ReactNode }) {
  // 요청마다(서버)·탭마다(브라우저) 쿼리 캐시를 따로 둔다.
  const [queryClient] = useState(createQueryClient);
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <TooltipProvider delayDuration={200}>
          {children}
          <Toaster position="top-center" closeButton />
        </TooltipProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}
