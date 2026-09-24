import { clamp } from "@/lib/utils";

export type MoneylineInjurySide = "subject" | "opponent";

export interface MoneylineInjuryInput {
  player: string;
  team: string;
  position: string;
  role?: "starter" | "backup" | null;
  side: MoneylineInjurySide;
  status: string | null;
  playProbability: number;
  expectedUsageIfActive: number;
  impactPoints: number;
  sources: string[];
}

export interface MoneylineInjuryScenario {
  player: string;
  team: string;
  position: string;
  role?: "starter" | "backup" | null;
  side: MoneylineInjurySide;
  status: string | null;
  playProbabilityBps: number;
  activeWinProbabilityBps: number;
  inactiveWinProbabilityBps: number;
  impactPoints: number;
  uncertaintyPenaltyBps: number;
  sources: string[];
}

export interface MoneylineInjuryResult {
  baselineProbability: number;
  adjustedProbability: number;
  reliabilityPenalty: number;
  scenarios: MoneylineInjuryScenario[];
}

function erf(value: number) {
  const sign = value < 0 ? -1 : 1;
  const x = Math.abs(value);
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const t = 1 / (1 + p * x);
  const y =
    1 -
    (((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t) *
      Math.exp(-x * x);
  return sign * y;
}

function winProbability(margin: number, stdDev: number) {
  const boundedStdDev = Math.max(2.5, stdDev);
  return clamp(
    1 - 0.5 * (1 + erf((0 - margin) / (boundedStdDev * Math.sqrt(2)))),
    0.01,
    0.99,
  );
}

/**
 * Applies player availability as explicit active/out scenarios to the internal
 * team-strength margin. It deliberately knows nothing about ESPN or betting
 * prices, so neither can be adjusted or leak into this calculation.
 */
export function applyMoneylineInjuryScenarios(input: {
  baselineMargin: number;
  marginStdDev: number;
  players: MoneylineInjuryInput[];
}): MoneylineInjuryResult {
  const baselineProbability = winProbability(
    input.baselineMargin,
    input.marginStdDev,
  );
  const players = input.players
    .filter((player) => {
      if (!Number.isFinite(player.impactPoints) || player.impactPoints <= 0) {
        return false;
      }
      const play = clamp(player.playProbability, 0, 1);
      const usage = clamp(player.expectedUsageIfActive, 0, 1);
      // A confirmed healthy/full-role player is already represented by the
      // historical team baseline and should not create a phantom adjustment.
      return play < 0.985 || usage < 0.98;
    })
    .slice(0, 6);

  if (!players.length) {
    return {
      baselineProbability,
      adjustedProbability: baselineProbability,
      reliabilityPenalty: 0,
      scenarios: [],
    };
  }

  const scenarios: MoneylineInjuryScenario[] = [];
  let reliabilityPenalty = 0;

  for (const player of players) {
    const play = clamp(player.playProbability, 0, 1);
    const usage = clamp(player.expectedUsageIfActive, 0, 1);
    const impact = clamp(
      player.impactPoints,
      0,
      player.position === "QB"
        ? player.role === "starter"
          ? 10.5
          : 3
        : 2.5,
    );
    const direction = player.side === "subject" ? -1 : 1;
    const activeShift = direction * impact * (1 - usage);
    const inactiveShift = direction * impact;
    const activeProbability = winProbability(
      input.baselineMargin + activeShift,
      input.marginStdDev,
    );
    const inactiveProbability = winProbability(
      input.baselineMargin + inactiveShift,
      input.marginStdDev,
    );
    const uncertainty = 4 * play * (1 - play);
    const penalty =
      Math.abs(activeProbability - inactiveProbability) * uncertainty * 0.75;
    reliabilityPenalty += penalty;

    scenarios.push({
      player: player.player,
      team: player.team,
      position: player.position,
      role: player.role ?? null,
      side: player.side,
      status: player.status,
      playProbabilityBps: Math.round(play * 10_000),
      activeWinProbabilityBps: Math.round(activeProbability * 10_000),
      inactiveWinProbabilityBps: Math.round(inactiveProbability * 10_000),
      impactPoints: impact,
      uncertaintyPenaltyBps: Math.round(penalty * 10_000),
      sources: [...new Set(player.sources)],
    });
  }

  // Enumerating the small scenario set preserves the actual probability
  // mixture rather than pretending a percentage-point penalty is linear.
  let states = [{ probability: 1, marginShift: 0 }];
  for (const player of players) {
    const play = clamp(player.playProbability, 0, 1);
    const usage = clamp(player.expectedUsageIfActive, 0, 1);
    const impact = clamp(
      player.impactPoints,
      0,
      player.position === "QB"
        ? player.role === "starter"
          ? 10.5
          : 3
        : 2.5,
    );
    const direction = player.side === "subject" ? -1 : 1;
    const activeShift = direction * impact * (1 - usage);
    const inactiveShift = direction * impact;
    states = states.flatMap((state) => [
      {
        probability: state.probability * play,
        marginShift: clamp(state.marginShift + activeShift, -12, 12),
      },
      {
        probability: state.probability * (1 - play),
        marginShift: clamp(state.marginShift + inactiveShift, -12, 12),
      },
    ]);
  }

  const adjustedProbability = states.reduce(
    (sum, state) =>
      sum +
      state.probability *
        winProbability(
          input.baselineMargin + state.marginShift,
          input.marginStdDev,
        ),
    0,
  );

  return {
    baselineProbability,
    adjustedProbability: clamp(adjustedProbability, 0.01, 0.99),
    reliabilityPenalty: clamp(reliabilityPenalty, 0, 0.18),
    scenarios,
  };
}
