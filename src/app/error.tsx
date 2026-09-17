"use client";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto max-w-lg rounded-lg border bg-surface px-6 py-16 text-center">
      <h1 className="text-lg font-semibold">Market data is temporarily unavailable</h1>
      <p className="mt-2 text-sm leading-6 text-muted">Lynerva did not substitute mock prices. Try the providers again in a moment.</p>
      <button type="button" onClick={reset} className="mt-5 rounded-md bg-foreground px-4 py-2 text-xs font-medium text-background">Try again</button>
    </div>
  );
}
