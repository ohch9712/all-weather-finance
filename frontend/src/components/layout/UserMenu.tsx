"use client";

import Link from "next/link";
import { LogOut, UserRound } from "lucide-react";
import { toast } from "sonner";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/features/auth/AuthProvider";
import { getErrorMessage } from "@/lib/api-client";

/** 상단 바 사용자 메뉴: 이메일, 프로필 설정, 로그아웃 */
export function UserMenu() {
  const { user, profile, logout } = useAuth();
  if (!user) return null;
  const initial = (profile?.nickname || user.email).slice(0, 1).toUpperCase();

  async function handleLogout() {
    try {
      await logout();
    } catch (error) {
      toast.error(getErrorMessage(error));
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="h-9 max-w-56 gap-2 px-1.5 sm:px-2" aria-label="사용자 메뉴">
          <Avatar className="size-7">
            <AvatarFallback className="text-xs">{initial}</AvatarFallback>
          </Avatar>
          <span className="hidden truncate text-sm sm:inline">{user.email}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="font-normal">
          <span className="block text-xs text-muted-foreground">로그인 계정</span>
          <span className="block truncate text-sm text-foreground">{user.email}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/settings/profile">
            <UserRound aria-hidden="true" />
            프로필 설정
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void handleLogout()}>
          <LogOut aria-hidden="true" />
          로그아웃
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
