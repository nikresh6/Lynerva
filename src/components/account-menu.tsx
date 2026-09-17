"use client";

import Link from "next/link";
import { UserRound } from "lucide-react";
import { useSession } from "@/lib/auth-client";

export function AccountMenu() {
  const { data, isPending } = useSession();
  if (isPending) return <div className="size-8 rounded-full bg-border" aria-hidden />;
  if (!data?.user) {
    return (
      <Link href="/sign-in" className="rounded-md border bg-surface px-3 py-1.5 text-xs font-medium transition-colors hover:border-border-strong">
        Sign in
      </Link>
    );
  }
  return (
    <Link href="/account" className="grid size-8 place-items-center rounded-full border bg-surface text-muted transition-colors hover:border-border-strong hover:text-foreground" aria-label="Account" title={data.user.email}>
      <UserRound size={15} strokeWidth={1.7} />
    </Link>
  );
}
