"use client";

import { useState } from "react";
import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { APP_NAME } from "@/lib/site";
import { NavLinks } from "./NavLinks";

/** 모바일(<1024px) 햄버거 메뉴 */
export function MobileNav() {
  const [open, setOpen] = useState(false);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="-ml-2 lg:hidden" aria-label="메뉴 열기">
          <Menu aria-hidden="true" />
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="w-72 max-w-[85vw] gap-0 bg-sidebar p-0">
        <SheetHeader className="h-14 justify-center border-b px-5 py-0">
          <SheetTitle>{APP_NAME}</SheetTitle>
          <SheetDescription className="sr-only">주 메뉴</SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 py-4">
          <NavLinks onNavigate={() => setOpen(false)} />
        </div>
      </SheetContent>
    </Sheet>
  );
}
