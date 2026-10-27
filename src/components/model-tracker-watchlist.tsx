import { Star, LockKeyhole, Clock3 } from "lucide-react";
import type { WeeklyScorecard } from "@/lib/model/scorecard";

export function ModelTrackerWatchlist({ week }: { week?: WeeklyScorecard }) {
  const followed = week?.picks.filter(
    (pick) => pick.trackingStatus === "slated" || pick.trackingStatus === "locked",
  ) ?? [];

  return (
    <section className="mb-8 rounded-[24px] border bg-surface p-5 sm:p-6">
      <div className="flex items-start gap-3">
        <div className="grid size-10 shrink-0 place-items-center rounded-xl border bg-background text-amber-500">
          <Star className="size-5 fill-current" />
        </div>
        <div>
          <p className="eyebrow">Huddlemark model tracker</p>
          <h2 className="mt-1 text-xl font-semibold tracking-[-0.025em]">
            {week ? `${week.label} · ${followed.length} starred picks` : "No active model watchlist"}
          </h2>
          <p className="mt-2 max-w-3xl text-xs leading-5 text-muted">
            These are exactly the picks starred on Results. A star means currently
            slated for the frozen model scorecard, or already frozen. The
            pregame list can change until the cutoff. This watchlist is
            separate from your manually entered bets below; no wager is placed.
          </p>
        </div>
      </div>
      {followed.length ? (
        <div className="mt-5 grid gap-2 sm:grid-cols-2">
          {followed.map((pick) => (
            <div key={pick.id} className="rounded-xl border bg-background p-3">
              <div className="flex items-center gap-2">
                <Star className="size-3.5 shrink-0 fill-amber-500 text-amber-500" aria-hidden="true" />
                <p className="min-w-0 flex-1 text-xs font-semibold">{pick.title}</p>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] text-muted">
                <span>{pick.slot}</span>
                <span>·</span>
                <span className="inline-flex items-center gap-1">
                  {pick.trackingStatus === "locked" ? (
                    <LockKeyhole className="size-3" aria-hidden="true" />
                  ) : (
                    <Clock3 className="size-3" aria-hidden="true" />
                  )}
                  {pick.trackingStatus === "locked" ? "Frozen" : "Slated, not frozen"}
                </span>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-4 text-xs text-muted">
          No fresh selections currently qualify for a star. An empty
          watchlist is not a prediction and should not be treated as a signal.
        </p>
      )}
    </section>
  );
}
