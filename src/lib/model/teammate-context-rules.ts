import type { CanonicalMarket } from "@/lib/markets/types";

export type SkillPosition = "QB" | "RB" | "WR" | "TE";
export type TeammateContextMode =
  | "receiving_redistribution"
  | "rushing_redistribution"
  | "passing_efficiency_loss";

function normalizedPosition(position: string | null | undefined) {
  const value = (position ?? "").toUpperCase();
  return value === "QB" || value === "RB" || value === "WR" || value === "TE"
    ? (value as SkillPosition)
    : null;
}

function isPassCatcher(position: SkillPosition | null) {
  return position === "WR" || position === "TE" || position === "RB";
}

export function teammateContextMode(input: {
  family: CanonicalMarket["family"];
  targetPosition: string | null | undefined;
  teammatePosition: string | null | undefined;
}): TeammateContextMode | null {
  const target = normalizedPosition(input.targetPosition);
  const teammate = normalizedPosition(input.teammatePosition);

  if (
    (input.family === "receiving_yards" || input.family === "receptions") &&
    isPassCatcher(target) &&
    isPassCatcher(teammate)
  ) {
    return "receiving_redistribution";
  }

  // Rushing workload is not fungible across every offensive position.
  // A WR being unavailable should not create RB or QB rushing yards. Keep
  // direct rushing redistribution to the RB room, where carries really are
  // commonly reallocated when another back is unavailable.
  if (
    input.family === "rushing_yards" &&
    target === "RB" &&
    teammate === "RB"
  ) {
    return "rushing_redistribution";
  }

  // Losing a pass catcher can reduce a quarterback's passing efficiency.
  // This is modeled separately from target redistribution and is intentionally
  // conservative so it does not simply subtract the missing receiver's yards.
  if (
    input.family === "passing_yards" &&
    target === "QB" &&
    isPassCatcher(teammate)
  ) {
    return "passing_efficiency_loss";
  }

  return null;
}

export function teammateVolumeFamily(
  family: CanonicalMarket["family"],
): CanonicalMarket["family"] | null {
  if (family === "passing_yards") return "receiving_yards";
  if (
    family === "receiving_yards" ||
    family === "receptions" ||
    family === "rushing_yards"
  ) {
    return family;
  }
  return null;
}

export function passingEfficiencyLossRate(
  teammatePosition: string | null | undefined,
) {
  const position = normalizedPosition(teammatePosition);
  if (position === "WR") return 0.18;
  if (position === "TE") return 0.14;
  if (position === "RB") return 0.08;
  return 0;
}
