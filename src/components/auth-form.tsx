"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { authClient } from "@/lib/auth-client";

function authErrorMessage(error: { message?: string | null; status?: number } | null) {
  const message = error?.message?.trim();
  if (message) return message;

  if (error?.status === 429) {
    return "Too many attempts. Wait a minute and try again.";
  }

  if (error?.status && error.status >= 500) {
    return "The account service is temporarily unavailable. Try again in a moment.";
  }

  return "Unable to continue. Please try again.";
}

export function AuthForm({ mode }: { mode: "sign-in" | "sign-up" }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);

    try {
      const formData = new FormData(event.currentTarget);
      const email = String(formData.get("email") ?? "").trim();
      const password = String(formData.get("password") ?? "");
      const name = String(formData.get("name") ?? "").trim();

      const result =
        mode === "sign-up"
          ? await authClient.signUp.email({
              name,
              email,
              password,
              callbackURL: "/tracker",
            })
          : await authClient.signIn.email({
              email,
              password,
              callbackURL: "/tracker",
            });

      if (result.error) {
        setError(authErrorMessage(result.error));
        return;
      }

      router.push("/tracker");
      router.refresh();
    } catch (caught) {
      console.error("Authentication request failed", caught);
      setError("The account service could not be reached. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-sm pt-10 sm:pt-16">
      <div className="mb-7">
        <p className="text-[11px] font-semibold tracking-[0.14em] text-faint">
          LYNERVA
        </p>
        <h1 className="mt-3 text-2xl font-semibold tracking-[-0.03em]">
          {mode === "sign-in" ? "Sign in" : "Create an account"}
        </h1>
        <p className="mt-1.5 text-sm text-muted">
          {mode === "sign-in"
            ? "Access your private position tracker."
            : "Your tracker data stays scoped to your account."}
        </p>
      </div>

      <form onSubmit={submit} className="space-y-4">
        {mode === "sign-up" ? (
          <label className="block">
            <span className="mb-1.5 block text-xs text-muted">Name</span>
            <input
              name="name"
              autoComplete="name"
              required
              minLength={2}
              className="h-10 w-full rounded-md border bg-surface px-3 outline-none focus:border-foreground"
            />
          </label>
        ) : null}

        <label className="block">
          <span className="mb-1.5 block text-xs text-muted">Email</span>
          <input
            name="email"
            type="email"
            autoComplete="email"
            required
            className="h-10 w-full rounded-md border bg-surface px-3 outline-none focus:border-foreground"
          />
        </label>

        <label className="block">
          <span className="mb-1.5 block text-xs text-muted">Password</span>
          <input
            name="password"
            type="password"
            autoComplete={mode === "sign-in" ? "current-password" : "new-password"}
            required
            minLength={10}
            maxLength={128}
            className="h-10 w-full rounded-md border bg-surface px-3 outline-none focus:border-foreground"
          />
          <span className="mt-1 block text-[10px] text-faint">
            At least 10 characters
          </span>
        </label>

        {error ? (
          <p
            role="alert"
            className="rounded-md bg-negative-bg px-3 py-2 text-xs text-negative"
          >
            {error}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={pending}
          className="h-10 w-full rounded-md bg-foreground text-sm font-medium text-background transition-opacity disabled:opacity-50"
        >
          {pending ? "Working…" : mode === "sign-in" ? "Sign in" : "Create account"}
        </button>
      </form>

      <div className="mt-5 flex justify-between text-xs text-muted">
        <Link
          href={mode === "sign-in" ? "/sign-up" : "/sign-in"}
          className="hover:text-foreground"
        >
          {mode === "sign-in" ? "Create account" : "Already have an account?"}
        </Link>
        {mode === "sign-in" ? (
          <Link href="/forgot-password" className="hover:text-foreground">
            Forgot password?
          </Link>
        ) : null}
      </div>
    </div>
  );
}
