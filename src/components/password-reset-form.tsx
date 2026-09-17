"use client";

import Link from "next/link";
import { useState } from "react";
import { authClient } from "@/lib/auth-client";

export function RequestResetForm() {
  const [state, setState] = useState<"idle" | "pending" | "sent" | "error">("idle");
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState("pending");
    const data = new FormData(event.currentTarget);
    const result = await authClient.requestPasswordReset({ email: String(data.get("email")), redirectTo: "/reset-password" });
    setState(result.error ? "error" : "sent");
  }
  return <div className="mx-auto max-w-sm pt-16"><h1 className="text-2xl font-semibold tracking-[-0.03em]">Reset your password</h1><p className="mt-2 text-sm leading-6 text-muted">Enter your account email and we’ll send a one-hour reset link.</p>{state === "sent" ? <div className="mt-6 rounded-md border bg-surface p-4 text-sm">If an account exists, a reset link is on its way.<div className="mt-4"><Link href="/sign-in" className="text-xs font-medium hover:underline">Return to sign in</Link></div></div> : <form onSubmit={submit} className="mt-6 space-y-4"><label className="block"><span className="mb-1.5 block text-xs text-muted">Email</span><input name="email" type="email" required autoComplete="email" className="h-10 w-full rounded-md border bg-surface px-3 outline-none focus:border-foreground" /></label>{state === "error" ? <p className="text-xs text-negative">Unable to send the reset email. Try again shortly.</p> : null}<button disabled={state === "pending"} className="h-10 w-full rounded-md bg-foreground text-sm font-medium text-background disabled:opacity-50">{state === "pending" ? "Sending…" : "Send reset link"}</button></form>}</div>;
}

export function ResetPasswordForm({ token }: { token: string | null }) {
  const [state, setState] = useState<"idle" | "pending" | "done" | "error">("idle");
  if (!token) return <div className="mx-auto max-w-sm pt-16"><h1 className="text-2xl font-semibold">Invalid reset link</h1><p className="mt-2 text-sm text-muted">This password reset link is missing its token.</p><Link href="/forgot-password" className="mt-5 inline-block text-xs font-medium hover:underline">Request a new link</Link></div>;
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState("pending");
    const data = new FormData(event.currentTarget);
    const result = await authClient.resetPassword({ newPassword: String(data.get("password")), token: token ?? "" });
    setState(result.error ? "error" : "done");
  }
  return <div className="mx-auto max-w-sm pt-16"><h1 className="text-2xl font-semibold tracking-[-0.03em]">Choose a new password</h1>{state === "done" ? <div className="mt-6 rounded-md border bg-surface p-4 text-sm">Your password has been changed.<div className="mt-4"><Link href="/sign-in" className="text-xs font-medium hover:underline">Sign in</Link></div></div> : <form onSubmit={submit} className="mt-6 space-y-4"><label className="block"><span className="mb-1.5 block text-xs text-muted">New password</span><input name="password" type="password" required minLength={10} maxLength={128} autoComplete="new-password" className="h-10 w-full rounded-md border bg-surface px-3 outline-none focus:border-foreground" /></label>{state === "error" ? <p className="text-xs text-negative">This link is invalid or expired. Request a new one.</p> : null}<button disabled={state === "pending"} className="h-10 w-full rounded-md bg-foreground text-sm font-medium text-background disabled:opacity-50">{state === "pending" ? "Updating…" : "Update password"}</button></form>}</div>;
}
