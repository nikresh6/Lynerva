import type { ProviderResult } from "@/lib/markets/types";
import { relativeTime } from "@/lib/utils";

export function SourceStatus({ providers, fixtureMode }: { providers: ProviderResult[]; fixtureMode: boolean }) {
  return (
    <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted">
      {providers.map((provider) => (
        <span key={provider.provider} className="inline-flex items-center gap-1.5 capitalize">
          <span className={`size-1.5 rounded-full ${provider.error ? "bg-negative" : provider.markets.length ? "bg-positive" : "bg-warning"}`} />
          {provider.provider}: {provider.error ? "unavailable" : `${provider.markets.length} NFL singles`} · {relativeTime(provider.fetchedAt)}
        </span>
      ))}
      {fixtureMode ? <span className="rounded bg-warning-bg px-1.5 py-0.5 font-medium text-warning">Development fixtures</span> : null}
    </div>
  );
}
