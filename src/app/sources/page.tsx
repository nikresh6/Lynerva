import type { Metadata } from "next";
import { PageHeading } from "@/components/page-heading";
import {
  getProjectionSourcePerformance,
  PROJECTION_SOURCE_INFO,
  type ProjectionPerformanceRow,
} from "@/lib/model/source-performance";

export const metadata: Metadata = { title: "Sources" };
export const dynamic = "force-dynamic";

const STAT_LABELS: Record<string, string> = {
  passing_yards: "Passing yards",
  passing_touchdowns: "Passing TDs",
  passing_interceptions: "Interceptions thrown",
  rushing_yards: "Rushing yards",
  rushing_touchdowns: "Rushing TDs",
  receiving_yards: "Receiving yards",
  receiving_touchdowns: "Receiving TDs",
  receptions: "Receptions",
  touchdowns: "Any TDs",
};

const STAT_ORDER = [
  "passing_yards",
  "passing_touchdowns",
  "passing_interceptions",
  "rushing_yards",
  "rushing_touchdowns",
  "receiving_yards",
  "receiving_touchdowns",
  "receptions",
  "touchdowns",
];

function sourceName(source: string) {
  return (
    PROJECTION_SOURCE_INFO[
      source as keyof typeof PROJECTION_SOURCE_INFO
    ]?.name ?? source
  );
}

function unit(stat: string) {
  if (stat.includes("yards")) return " yd";
  if (stat === "receptions") return " rec";
  if (stat === "passing_interceptions") return " INT";
  return " TD";
}

function metric(value: number, stat: string) {
  const digits = stat.includes("yards") ? 1 : 2;
  return `${value.toFixed(digits)}${unit(stat)}`;
}

function biasLabel(value: number, stat: string) {
  if (Math.abs(value) < 0.005) return "0";
  const digits = stat.includes("yards") ? 1 : 2;
  return `${value > 0 ? "+" : ""}${value.toFixed(digits)}${unit(stat)}`;
}

function PerformanceTable({
  statistic,
  rows,
}: {
  statistic: string;
  rows: ProjectionPerformanceRow[];
}) {
  const bySource = rows
    .filter((row) => row.statistic === statistic)
    .toSorted(
      (a, b) =>
        a.medianAbsoluteError - b.medianAbsoluteError ||
        b.sampleSize - a.sampleSize,
    );

  return (
    <section className="overflow-hidden rounded-xl border bg-surface">
      <div className="border-b px-4 py-3.5 sm:px-5">
        <h2 className="text-sm font-semibold">
          {STAT_LABELS[statistic] ?? statistic}
        </h2>
        <p className="mt-1 text-[11px] text-muted">
          Error is measured against settled regular-season NFL player stats.
        </p>
      </div>

      {bySource.length === 0 ? (
        <div className="px-5 py-8 text-sm text-muted">
          No settled projection samples yet.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-xs">
            <thead className="border-b bg-background text-[10px] uppercase tracking-[0.08em] text-faint">
              <tr>
                <th className="px-4 py-2.5 font-medium sm:px-5">Source</th>
                <th className="px-3 py-2.5 font-medium">Typical miss</th>
                <th className="px-3 py-2.5 font-medium">Bad miss</th>
                <th className="px-3 py-2.5 font-medium">RMSE</th>
                <th className="px-3 py-2.5 font-medium">Bias</th>
                <th className="px-3 py-2.5 font-medium">Samples</th>
                <th className="px-4 py-2.5 font-medium sm:px-5">
                  Current weight
                </th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {bySource.map((row) => (
                <tr key={row.source}>
                  <td className="px-4 py-3 font-medium sm:px-5">
                    {sourceName(row.source)}
                  </td>
                  <td className="px-3 py-3 tabular">
                    {metric(row.medianAbsoluteError, statistic)}
                  </td>
                  <td className="px-3 py-3 tabular text-muted">
                    {metric(row.p90AbsoluteError, statistic)}
                  </td>
                  <td className="px-3 py-3 tabular text-muted">
                    {metric(row.rmse, statistic)}
                  </td>
                  <td className="px-3 py-3 tabular text-muted">
                    {biasLabel(row.bias, statistic)}
                  </td>
                  <td className="px-3 py-3 tabular text-muted">
                    {row.sampleSize}
                  </td>
                  <td className="px-4 py-3 tabular sm:px-5">
                    {row.weight === null
                      ? "Equal prior"
                      : `${(row.weight * 100).toFixed(1)}%${
                          row.weightWeek ? ` · W${row.weightWeek}` : ""
                        }`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export default async function SourcesPage() {
  const performance = await getProjectionSourcePerformance(2026);

  return (
    <>
      <PageHeading
        title="Projection sources"
        description="Every outside projection Lynerva uses, plus how each source has actually performed after games settle."
      />

      <div className="space-y-6">
        <section>
          <div className="mb-3">
            <h2 className="text-sm font-semibold">Active free sources</h2>
            <p className="mt-1 max-w-3xl text-xs leading-5 text-muted">
              These are the only outside projection sources currently allowed
              into Lynerva. They are reachable without a paid API key or paid
              account. Lynerva accepts only the requested NFL week. Missing
              data stays missing instead of being replaced with season or
              rest-of-season projections.
            </p>
          </div>

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {performance.sources.map((source) => (
              <a
                key={source.id}
                href={source.href}
                target="_blank"
                rel="noreferrer"
                className="rounded-xl border bg-surface p-4 transition-colors hover:bg-surface-raised"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold">{source.name}</h3>
                    <p className="mt-0.5 text-[10px] uppercase tracking-[0.08em] text-faint">
                      {source.kind}
                    </p>
                  </div>
                  <span className="rounded-full border px-2 py-1 text-[9px] font-medium text-muted">
                    Active
                  </span>
                </div>
                <p className="mt-3 text-xs font-medium">{source.access}</p>
                <p className="mt-1.5 text-[11px] leading-5 text-muted">
                  {source.note}
                </p>
              </a>
            ))}
          </div>
        </section>

        <section className="rounded-xl border bg-surface p-4 sm:p-5">
          <h2 className="text-sm font-semibold">How accuracy is measured</h2>
          <div className="mt-3 grid gap-4 text-xs leading-5 text-muted md:grid-cols-3">
            <div>
              <strong className="text-foreground">Typical miss</strong> is the
              median absolute error. Half of that source&apos;s settled
              projections missed by less, and half missed by more. It is much
              less distorted by one awful projection than a simple average.
            </div>
            <div>
              <strong className="text-foreground">Bad miss</strong> is the 90th
              percentile absolute error. It shows how ugly the source&apos;s
              worse misses tend to get instead of hiding them inside one
              average.
            </div>
            <div>
              <strong className="text-foreground">Bias</strong> shows direction.
              Positive means the source tends to project too high, negative
              means too low. Lynerva also shows RMSE because it penalizes large
              misses more heavily.
            </div>
          </div>
          <p className="mt-3 text-[10px] leading-4 text-faint">
            Lynerva only grades projections captured before kickoff and only
            against regular-season results. Learned weights use a robust mix of
            typical miss, recent typical miss, and 90th-percentile miss, so one
            freak projection cannot wreck an otherwise accurate source. Small
            samples remain close to equal weight until enough settled
            player-weeks accumulate.
          </p>
        </section>

        <section>
          <div className="mb-3">
            <h2 className="text-sm font-semibold">
              {performance.season} source accuracy by stat
            </h2>
            <p className="mt-1 text-xs text-muted">
              Compare sources within a stat. Yardage error and touchdown error
              are different units, so they should not be combined into one
              fake universal accuracy score.
            </p>
          </div>
          <div className="grid gap-4">
            {STAT_ORDER.map((statistic) => (
              <PerformanceTable
                key={statistic}
                statistic={statistic}
                rows={performance.rows}
              />
            ))}
          </div>
        </section>

        <section className="rounded-xl border bg-surface p-4 sm:p-5">
          <h2 className="text-sm font-semibold">Ground truth</h2>
          <p className="mt-2 max-w-4xl text-xs leading-5 text-muted">
            Settled player results come from the open-source nflverse data
            project. Those realized NFL stats grade every stored projection and
            feed Lynerva&apos;s source-weight learning loop. Market prices are
            still pulled separately from Kalshi and Polymarket and are never
            treated as an outside player projection.
          </p>
          <a
            href="https://github.com/nflverse/nflverse-data"
            target="_blank"
            rel="noreferrer"
            className="mt-3 inline-flex text-xs font-medium underline underline-offset-4"
          >
            Open nflverse on GitHub
          </a>
        </section>
      </div>
    </>
  );
}
