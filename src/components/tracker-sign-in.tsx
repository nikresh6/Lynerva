import Link from "next/link";

export function TrackerSignIn() {
  return <div className="mx-auto max-w-lg rounded-lg border bg-surface px-6 py-16 text-center"><h2 className="text-lg font-semibold">Your private tracker</h2><p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-muted">Sign in to record positions manually. Lynerva never connects to or trades through your market accounts.</p><div className="mt-6 flex justify-center gap-2"><Link href="/sign-in" className="rounded-md bg-foreground px-4 py-2 text-xs font-medium text-background">Sign in</Link><Link href="/sign-up" className="rounded-md border px-4 py-2 text-xs font-medium">Create account</Link></div></div>;
}
