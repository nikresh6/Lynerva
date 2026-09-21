import "server-only";

import type { CanonicalMarket } from "@/lib/markets/types";
import { clamp } from "@/lib/utils";
import {
  getExternalProjectionConsensus,
  type ProjectionPoint,
} from "@/lib/model/external-projections";
import { getPlayerVisuals, getTeamRoster } from "@/lib/nfl/player-visuals";
import { findPublicPlayerSeasonHistory } from "@/lib/nfl/history";
import { getPregamePlayerAvailability } from "@/lib/nfl/pregame-injuries";

export interface TeammateContextAdjustment {
  adjustment: number;
  adjustedProjection: number;
  notes: string[];
  affectedBy: Array<{
    player: string;
    status: string | null;
    playProbability: number;
    projectedVolume: number;
    estimatedAddedVolume: number;
    unpricedFraction: number;
  }>;
}

function normalizePerson(value: string) {
  return value
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/\b(jr|sr|ii|iii|iv)\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function supportedFamily(family: CanonicalMarket["family"]) {
  return (
    family === "receiving_yards" ||
    family === "receptions" ||
    family === "rushing_yards"
  );
}

function teammatePositionEligible(
  family: CanonicalMarket["family"],
  position: string | null,
) {
  const normalized = (position ?? "").toUpperCase();
  if (family === "receiving_yards" || family === "receptions") {
    return ["WR", "TE", "RB"].includes(normalized);
  }
  if (family === "rushing_yards") {
    return ["RB", "QB", "WR"].includes(normalized);
  }
  return false;
}

function redistributionRate(family: CanonicalMarket["family"]) {
  if (family === "receiving_yards") return 0.52;
  if (family === "receptions") return 0.58;
  if (family === "rushing_yards") return 0.70;
  return 0;
}

function captureShare(input: {
  family: CanonicalMarket["family"];
  position: string | null;
  baselineProjection: number;
}) {
  const position = (input.position ?? "").toUpperCase();
  const projection = Math.max(0, input.baselineProjection);

  if (input.family === "receiving_yards") {
    if (position === "WR") return clamp(0.20 + projection / 500, 0.20, 0.42);
    if (position === "TE") return clamp(0.16 + projection / 650, 0.16, 0.32);
    if (position === "RB") return clamp(0.11 + projection / 700, 0.11, 0.27);
    return clamp(0.16 + projection / 650, 0.16, 0.34);
  }

  if (input.family === "receptions") {
    if (position === "WR") return clamp(0.22 + projection / 30, 0.22, 0.44);
    if (position === "TE") return clamp(0.18 + projection / 38, 0.18, 0.34);
    if (position === "RB") return clamp(0.14 + projection / 42, 0.14, 0.30);
    return clamp(0.18 + projection / 36, 0.18, 0.36);
  }

  if (input.family === "rushing_yards") {
    if (position === "RB") return clamp(0.34 + projection / 350, 0.34, 0.58);
    if (position === "QB") return clamp(0.12 + projection / 500, 0.12, 0.24);
    if (position === "WR") return clamp(0.10 + projection / 450, 0.10, 0.20);
    return 0.2;
  }

  return 0;
}

function weightedUnpricedFraction(input: {
  points: ProjectionPoint[];
  sourceWeights: Record<string, number> | null;
  eventAt: string | null;
  risk: "low" | "medium" | "high" | "out";
}) {
  if (!input.points.length) {
    return input.risk === "out"
      ? 0.45
      : input.risk === "high"
        ? 0.34
        : input.risk === "medium"
          ? 0.2
          : 0.1;
  }

  const eventMs = input.eventAt ? Date.parse(input.eventAt) : NaN;
  const rows = input.points.map((point) => {
    const weight = input.sourceWeights?.[point.source] ?? 1;

    if (!Number.isFinite(eventMs)) {
      return {
        weight,
        fraction:
          input.risk === "out"
            ? 0.4
            : input.risk === "high"
              ? 0.3
              : input.risk === "medium"
                ? 0.18
                : 0.08,
      };
    }

    const firstObserved = Date.parse(
      point.firstObservedAt ?? point.fetchedAt,
    );
    const lastChanged = point.lastChangedAt
      ? Date.parse(point.lastChangedAt)
      : NaN;

    // A source that visibly changed after the material injury report probably
    // incorporated most of the news. If it was already observed before the
    // report and has not moved, treat much more of the context as unpriced.
    if (
      Number.isFinite(lastChanged) &&
      lastChanged >= eventMs + 60_000
    ) {
      return { weight, fraction: 0.08 };
    }
    if (Number.isFinite(firstObserved) && firstObserved < eventMs) {
      return { weight, fraction: 0.88 };
    }

    // Cold-start ambiguity: the first value Huddlemark sees after the news may
    // already include it. Apply only a conservative partial adjustment.
    return { weight, fraction: 0.3 };
  });

  const totalWeight = rows.reduce((sum, row) => sum + row.weight, 0) || 1;
  return clamp(
    rows.reduce(
      (sum, row) => sum + row.fraction * (row.weight / totalWeight),
      0,
    ),
    0.05,
    0.9,
  );
}

async function computeTeammateContextAdjustment(input: {
  market: CanonicalMarket;
  season: number;
  week: number;
  baselineProjection: number;
  position: "QB" | "RB" | "WR" | "TE" | null;
  projectionPoints: ProjectionPoint[];
  sourceWeights: Record<string, number> | null;
  espnGameId?: string | null;
}): Promise<TeammateContextAdjustment | null> {
  if (!supportedFamily(input.market.family)) return null;

  const visual = (await getPlayerVisuals([input.market.subject]))[
    input.market.subject
  ];
  const team = visual?.team;
  const position = input.position ?? (visual?.position as
    | "QB"
    | "RB"
    | "WR"
    | "TE"
    | null
    | undefined) ?? null;
  if (!team) return null;

  const roster = (await getTeamRoster(team))
    .filter(
      (player) =>
        normalizePerson(player.fullName) !==
          normalizePerson(input.market.subject) &&
        teammatePositionEligible(input.market.family, player.position),
    )
    .slice(0, 18);

  const availabilityRows = await Promise.all(
    roster.map(async (player) => ({
      player,
      availability: await getPregamePlayerAvailability({
        subject: player.fullName,
        espnGameId: input.espnGameId ?? null,
      }),
    })),
  );

  const material = availabilityRows.filter(({ availability }) => {
    if (!availability) return false;
    return (
      availability.risk === "out" ||
      availability.risk === "high" ||
      availability.playProbability < 0.78
    );
  });

  if (!material.length) return null;

  const affectedBy: TeammateContextAdjustment["affectedBy"] = [];
  let adjustment = 0;

  for (const { player, availability } of material) {
    if (!availability) continue;

    const teammateMarket: CanonicalMarket = {
      ...input.market,
      key: input.market.key + ":context:" + normalizePerson(player.fullName),
      subject: player.fullName,
    };
    const teammateProjection = await getExternalProjectionConsensus(
      teammateMarket,
      input.week,
      input.season,
    );

    let projectedVolume = teammateProjection.projection;
    if (projectedVolume === null || projectedVolume <= 0) {
      // Projection sites often remove a player entirely once he is ruled out.
      // Recover his normal role from completed regular-season games so the
      // lost opportunity does not disappear from teammate context at the exact
      // moment it matters most.
      const statistic = input.market.statistic ?? input.market.family;
      const [currentHistory, priorHistory] = await Promise.all([
        findPublicPlayerSeasonHistory(
          player.fullName,
          statistic,
          input.season,
        ),
        findPublicPlayerSeasonHistory(
          player.fullName,
          statistic,
          input.season - 1,
        ),
      ]);
      const historyRows =
        currentHistory.values.length >= 3
          ? currentHistory.values.slice(0, 8)
          : priorHistory.values.slice(0, 12);
      if (historyRows.length) {
        projectedVolume =
          historyRows.reduce((sum, row) => sum + row.value, 0) /
          historyRows.length;
      }
    }

    if (projectedVolume === null || projectedVolume <= 0) continue;

    const unavailableShare = clamp(1 - availability.playProbability, 0, 1);
    if (unavailableShare < 0.18 && availability.risk !== "out") continue;

    const unpricedFraction = weightedUnpricedFraction({
      points: input.projectionPoints,
      sourceWeights: input.sourceWeights,
      eventAt: availability.newsPublishedAt,
      risk: availability.risk,
    });
    const teammateLostVolume = projectedVolume * unavailableShare;
    const estimatedAddedVolume =
      teammateLostVolume *
      redistributionRate(input.market.family) *
      captureShare({
        family: input.market.family,
        position,
        baselineProjection: input.baselineProjection,
      }) *
      unpricedFraction;

    if (!Number.isFinite(estimatedAddedVolume) || estimatedAddedVolume <= 0) {
      continue;
    }

    adjustment += estimatedAddedVolume;
    affectedBy.push({
      player: player.fullName,
      status: availability.status,
      playProbability: availability.playProbability,
      projectedVolume,
      estimatedAddedVolume,
      unpricedFraction,
    });
  }

  if (!affectedBy.length || adjustment <= 0) return null;

  // Context should move a stale projection, not overwhelm the independent
  // projection consensus. Cap the aggregate lift relative to the player's own
  // expected workload.
  const maxAdjustment =
    input.market.family === "receptions"
      ? Math.max(1.25, input.baselineProjection * 0.3)
      : Math.max(8, input.baselineProjection * 0.28);
  adjustment = clamp(adjustment, 0, maxAdjustment);

  const notes = affectedBy.map((row) => {
    const status = row.status ? " (" + row.status + ")" : "";
    return (
      row.player +
      status +
      " availability leaves an estimated " +
      row.estimatedAddedVolume.toFixed(
        input.market.family === "receptions" ? 1 : 0,
      ) +
      " " +
      (input.market.family === "receptions" ? "receptions" : "yards") +
      " of still-unpriced opportunity for " +
      input.market.subject +
      "."
    );
  });

  return {
    adjustment,
    adjustedProjection: input.baselineProjection + adjustment,
    notes,
    affectedBy,
  };
}

const contextCache = new Map<
  string,
  {
    expiresAt: number;
    promise: Promise<TeammateContextAdjustment | null>;
  }
>();

export function getTeammateContextAdjustment(
  input: Parameters<typeof computeTeammateContextAdjustment>[0],
) {
  const pointSignature = input.projectionPoints
    .map(
      (point) =>
        point.source +
        ":" +
        point.value.toFixed(2) +
        ":" +
        (point.lastChangedAt ?? point.firstObservedAt ?? ""),
    )
    .join("|");
  const key = [
    normalizePerson(input.market.subject),
    input.market.family,
    input.season,
    input.week,
    input.baselineProjection.toFixed(2),
    input.espnGameId ?? "",
    pointSignature,
  ].join(":");

  const cached = contextCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.promise;

  const promise = computeTeammateContextAdjustment(input);
  contextCache.set(key, {
    expiresAt: Date.now() + 90_000,
    promise,
  });
  promise.catch(() => contextCache.delete(key));
  return promise;
}
