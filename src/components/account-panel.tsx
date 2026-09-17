"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { authClient } from "@/lib/auth-client";

export function AccountPanel({ name, email }: { name: string; email: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  async function logOut() { setPending(true); await authClient.signOut(); router.push("/"); router.refresh(); }
  return <div className="mx-auto max-w-xl"><div className="rounded-lg border bg-surface"><div className="border-b p-5"><p className="text-sm font-medium">{name}</p><p className="mt-1 text-xs text-muted">{email}</p></div><div className="flex items-center justify-between p-5"><div><p className="text-sm font-medium">Session</p><p className="mt-1 text-xs text-muted">Sign out on this device.</p></div><button type="button" disabled={pending} onClick={logOut} className="rounded-md border px-3 py-2 text-xs font-medium hover:border-border-strong disabled:opacity-50">{pending ? "Signing out…" : "Sign out"}</button></div></div></div>;
}
