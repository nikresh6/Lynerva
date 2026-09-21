"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { LogOut, ShieldCheck, UserRound } from "lucide-react";
import { authClient } from "@/lib/auth-client";

export function AccountPanel({ name, email }: { name: string; email: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  async function logOut() {
    setPending(true);
    await authClient.signOut();
    router.push("/");
    router.refresh();
  }

  return (
    <div className="mx-auto max-w-2xl">
      <section className="premium-panel overflow-hidden rounded-[24px]">
        <div className="flex items-center gap-4 border-b bg-[linear-gradient(135deg,var(--surface-raised),var(--surface))] p-5 sm:p-7">
          <span className="grid size-12 shrink-0 place-items-center rounded-2xl border bg-background text-accent">
            <UserRound className="size-5" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-lg font-semibold">{name}</p>
            <p className="mt-1 truncate text-xs text-muted">{email}</p>
          </div>
        </div>
        <div className="grid gap-4 p-5 sm:grid-cols-[1fr_auto] sm:items-center sm:p-7">
          <div className="flex gap-3">
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-positive" />
            <div>
              <p className="text-sm font-semibold">Private tracker session</p>
              <p className="mt-1 max-w-md text-xs leading-5 text-muted">
                Your account keeps tracked bets synced across devices. Signing out does not erase them.
              </p>
            </div>
          </div>
          <button
            type="button"
            disabled={pending}
            onClick={logOut}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border bg-background px-4 text-xs font-semibold transition-colors hover:border-border-strong hover:bg-surface-raised disabled:opacity-50"
          >
            <LogOut className="size-3.5" />
            {pending ? "Signing out…" : "Sign out"}
          </button>
        </div>
      </section>
    </div>
  );
}
