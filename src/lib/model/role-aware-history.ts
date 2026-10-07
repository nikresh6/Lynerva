import type { MarketFamily } from "@/lib/markets/types";
import type { HistoricalValue } from "@/lib/nfl/history";
import { clamp } from "@/lib/utils";

export type PlayerRoleShift = "up" | "down" | "stable";

export interface PlayerRoleContext {
  rawHitRate: number | null;
  recencyWeightedHitRate: number | null;
  roleContinuity: number;
  roleShift: PlayerRoleShift;
  recentOpportunityAverage: number | null;
  priorOpportunityAverage: number | null;
  projectionVsRecentProduction: number | null;
  reasons: string[];
}

function isHit(value: number, threshold: number, direction: string) {
  return direction === "under" ? value < threshold : value >= threshold;
}

function average(values: number[]) {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function opportunityForGame(
  family: MarketFamily,
  game: HistoricalValue,
) {
  if (
    family === "passing_yards" ||
    family === "passing_touchdowns" ||
    family === "passing_interceptions"
  ) {
    return game.passingAttempts ?? null;
  }

  if (family === "rushing_yards" || family === "rushing_touchdowns") {
    return game.rushingAttempts ?? null;
  }

  if (
    family === "receiving_yards" ||
    family === "receiving_touchdowns" ||
    family === "receptions" ||
    family === "longest_reception"
  ) {
    return game.targets ?? game.receptions ?? null;
  }

  if (family === "touchdowns") {
    const rush = game.rushingAttempts ?? 0;
    const targets = game.targets ?? 0;
    const total = rush + targets;
    return total > 0 ? total : null;
  }

  return null;
}

function meaningfulOpportunityChange(
  family: MarketFamily,
  recent: number,
  prior: number,
) {
  const absoluteFloor =
    family === "passing_yards" ||
    family === "passing_touchdowns" ||
    family === "passing_interceptions"
      ? 7
      : family === "rushing_yards" || family === "rushing_touchdowns"
        ? 4
        : 2;

  const difference = recent - prior;
  const ratio = recent / Math.max(prior, 1);
  if (difference >= absoluteFloor && ratio >= 1.28) return "up" as const;
  if (difference <= -absoluteFloor && ratio <= 0.72) return "down" as const;
  return "stable" as const;
}

function projectionShift(
  family: MarketFamily,
  projection: number,
  recentProduction: number,
) {
  const floor =
    family === "passing_yards"
      ? 35
      : family === "rushing_yards" || family === "receiving_yards"
        ? 8
        : family === "receptions"
          ? 1.25
          : 0.45;
  const difference = projection - recentProduction;
  const ratio = projection / Math.max(recentProduction, floor * 0.35, 0.1);

  if (difference >= floor && ratio >= 1.55) return "up" as const;
  if (difference <= -floor && ratio <= 0.58) return "down" as const;
  return "stable" as const;
}

export function estimatePlayerRoleContext(input: {
  family: MarketFamily;
  currentProjection: number | null;
  threshold: number;
  direction: string;
  games: HistoricalValue[];
}): PlayerRoleContext {
  const games = input.games.filter((game) => Number.isFinite(game.value));
  const reasons: string[] = [];
  if (!games.length) {
    return {
      rawHitRate: null,
      recencyWeightedHitRate: null,
      roleContinuity: 1,
      roleShift: "stable",
      recentOpportunityAverage: null,
      priorOpportunityAverage: null,
      projectionVsRecentProduction: null,
      reasons,
    };
  }

  const rawHits = games.filter((game) =>
    isHit(game.value, input.threshold, input.direction),
  ).length;
  const rawHitRate = rawHits / games.length;

  let weightedHits = 0;
  let totalWeight = 0;
  games.forEach((game, index) => {
    const weight = Math.pow(0.82, index);
    weightedHits +=
      (isHit(game.value, input.threshold, input.direction) ? 1 : 0) * weight;
    totalWeight += weight;
  });
  const recencyWeightedHitRate =
    totalWeight > 0 ? weightedHits / totalWeight : rawHitRate;

  const opportunities = games
    .map((game) => opportunityForGame(input.family, game))
    .map((value) =>
      value !== null && Number.isFinite(value) ? Math.max(0, value) : null,
    );
  const recentOpportunityAverage = average(
    opportunities.slice(0, 2).filter((value): value is number => value !== null),
  );
  const priorOpportunityAverage = average(
    opportunities.slice(2, 6).filter((value): value is number => value !== null),
  );

  let opportunityShift: PlayerRoleShift = "stable";
  if (
    recentOpportunityAverage !== null &&
    priorOpportunityAverage !== null
  ) {
    opportunityShift = meaningfulOpportunityChange(
      input.family,
      recentOpportunityAverage,
      priorOpportunityAverage,
    );
    if (opportunityShift !== "stable") {
      reasons.push(
        `Recent opportunity is ${opportunityShift === "up" ? "materially above" : "materially below"} the player's earlier 2026 role.`,
      );
    }
  }

  const recentProduction = average(games.slice(0, 3).map((game) => game.value));
  let projectionSignal: PlayerRoleShift = "stable";
  let projectionVsRecentProduction: number | null = null;
  if (
    input.currentProjection !== null &&
    recentProduction !== null &&
    Number.isFinite(input.currentProjection)
  ) {
    projectionVsRecentProduction =
      input.currentProjection / Math.max(Math.abs(recentProduction), 0.1);
    projectionSignal = projectionShift(
      input.family,
      input.currentProjection,
      recentProduction,
    );
    if (projectionSignal !== "stable") {
      reasons.push(
        `Current source consensus implies a ${projectionSignal === "up" ? "larger" : "smaller"} role than recent production.`,
      );
    }
  }

  let roleShift: PlayerRoleShift = "stable";
  if (opportunityShift === projectionSignal && opportunityShift !== "stable") {
    roleShift = opportunityShift;
  } else if (opportunityShift !== "stable" && projectionSignal === "stable") {
    roleShift = opportunityShift;
  } else if (projectionSignal !== "stable" && opportunityShift === "stable") {
    roleShift = projectionSignal;
  }

  let roleContinuity = 1;
  if (roleShift !== "stable") {
    const corroborated =
      opportunityShift === roleShift && projectionSignal === roleShift;
    roleContinuity = corroborated ? 0.38 : 0.58;

    const opportunityRatio =
      recentOpportunityAverage !== null &&
      priorOpportunityAverage !== null
        ? recentOpportunityAverage / Math.max(priorOpportunityAverage, 1)
        : 1;
    const extremeOpportunityMove =
      roleShift === "up" ? opportunityRatio >= 1.8 : opportunityRatio <= 0.45;
    const extremeProjectionMove =
      projectionVsRecentProduction !== null &&
      (roleShift === "up"
        ? projectionVsRecentProduction >= 2
        : projectionVsRecentProduction <= 0.4);

    if (extremeOpportunityMove || extremeProjectionMove) {
      roleContinuity = Math.min(roleContinuity, 0.3);
    }

    reasons.push(
      "Older hit-rate games are being downweighted because they are not representative of the current role.",
    );
  }

  if (games.length < 4) {
    roleContinuity = Math.min(roleContinuity, 0.7);
  }

  return {
    rawHitRate,
    recencyWeightedHitRate,
    roleContinuity: clamp(roleContinuity, 0.25, 1),
    roleShift,
    recentOpportunityAverage,
    priorOpportunityAverage,
    projectionVsRecentProduction,
    reasons,
  };
}
