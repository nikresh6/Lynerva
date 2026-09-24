import { clamp } from "@/lib/utils";

export type InjuryRiskLevel = "low" | "medium" | "high" | "out";

export interface InjuryAvailabilitySignals {
  status?: string | null;
  detail?: string | null;
  bodyPart?: string | null;
  notes?: string | null;
  practiceParticipation?: string | null;
  practiceDescription?: string | null;
  news?: string | null;
  sources?: string[];
}

export interface InjuryAvailabilityEstimate {
  status: string | null;
  detail: string | null;
  bodyPart: string | null;
  practiceParticipation: string | null;
  playProbability: number;
  finishProbabilityIfActive: number;
  fullRoleProbability: number;
  expectedUsageIfActive: number;
  risk: InjuryRiskLevel;
  sources: string[];
  reasons: string[];
}

export function blendConditionalWithDnpFairValueBps(input: {
  conditionalProbabilityBps: number | null;
  playProbabilityBps: number | null;
  dnpFairValueBps: number | null;
}) {
  if (input.conditionalProbabilityBps === null) return null;
  if (
    input.playProbabilityBps === null ||
    input.dnpFairValueBps === null
  ) {
    return input.conditionalProbabilityBps;
  }
  const play = clamp(input.playProbabilityBps / 10_000, 0, 1);
  return Math.round(
    play * input.conditionalProbabilityBps +
      (1 - play) * input.dnpFairValueBps,
  );
}

function normalizedText(signals: InjuryAvailabilitySignals) {
  return [
    signals.status,
    signals.detail,
    signals.bodyPart,
    signals.notes,
    signals.practiceParticipation,
    signals.practiceDescription,
    signals.news,
  ]
    .filter(Boolean)
    .join(" · ")
    .toLowerCase();
}

function healthyBoilerplate(value: string | null | undefined) {
  if (!value) return true;
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return (
    normalized === "" ||
    normalized === "active" ||
    normalized === "healthy" ||
    normalized === "available" ||
    normalized === "injury_status_active" ||
    normalized === "no_injury" ||
    normalized === "none"
  );
}

function hasMeaningfulSignal(signals: InjuryAvailabilitySignals) {
  const values = [
    signals.status,
    signals.detail,
    signals.bodyPart,
    signals.notes,
    signals.practiceParticipation,
    signals.practiceDescription,
    signals.news,
  ];
  return values.some((value) => !healthyBoilerplate(value));
}

export function estimateInjuryAvailability(
  signals: InjuryAvailabilitySignals,
): InjuryAvailabilityEstimate | null {
  if (!hasMeaningfulSignal(signals)) return null;

  const text = normalizedText(signals);
  const status = signals.status?.trim() || null;
  const reasons: string[] = [];

  const onlyRestSignal =
    !signals.status &&
    !signals.detail &&
    !signals.bodyPart &&
    !signals.notes &&
    /\b(rest|veteran rest|not injury related|non-injury related)\b/.test(text);
  if (onlyRestSignal) return null;

  const ruledOut =
    /\bruled out\b|\binactive\b|will not play|won'?t play|\bout\b|injured reserve|\bir\b|physically unable to perform|\bpup\b/.test(
      text,
    );
  const doubtful = /\bdoubtful\b/.test(text);
  const questionable = /\bquestionable\b/.test(text);
  const probable = /\bprobable\b/.test(text);

  let playProbability = ruledOut
    ? 0
    : doubtful
      ? 0.12
      : questionable
        ? 0.68
        : probable
          ? 0.94
          : 0.92;

  if (ruledOut) reasons.push("Official designation indicates the player is out.");
  else if (doubtful) reasons.push("Doubtful designation starts with a low play prior.");
  else if (questionable) reasons.push("Questionable designation starts with a moderate play prior.");
  else if (probable) reasons.push("Probable designation starts with a high play prior.");
  else reasons.push("An injury signal exists without a firm game-status designation.");

  const dnpPractice =
    /did not participate|non-participant|\bdnp\b|didn'?t practice|did not practice|missed practice/.test(
      text,
    );
  const limitedPractice = /limited participant|limited practice|\blimited\b/.test(
    text,
  );
  const fullPractice =
    /full participant|full practice|practiced in full/.test(text);

  if (!ruledOut && dnpPractice) {
    playProbability -= 0.16;
    reasons.push("A missed practice lowers the estimated chance of playing.");
  } else if (!ruledOut && limitedPractice) {
    playProbability -= 0.06;
    reasons.push("Limited practice modestly lowers the estimated chance of playing.");
  } else if (!ruledOut && fullPractice) {
    playProbability += 0.05;
    reasons.push("A full practice raises the estimated chance of playing.");
  }

  const gameTimeDecision =
    /game[- ]time decision|pregame decision|pre-game decision|test.*warmup|warmup.*decision/.test(
      text,
    );
  if (!ruledOut && gameTimeDecision) {
    playProbability -= 0.08;
    reasons.push("A game-time decision adds meaningful availability uncertainty.");
  }

  if (
    !ruledOut &&
    /trending.{0,50}(?:out|not play|sit)|trending.*wrong|wrong direction|unlikely to play|not expected to play|long shot to play|leaning.{0,30}(?:out|sit)/.test(
      text,
    )
  ) {
    playProbability -= 0.18;
    reasons.push("Current wording indicates the player is trending away from playing.");
  }

  if (
    !ruledOut &&
    !doubtful &&
    !questionable &&
    /week[- ]to[- ]week/.test(text)
  ) {
    playProbability = Math.min(playProbability, 0.45);
    reasons.push("Week-to-week wording materially lowers the near-term play estimate.");
  }

  if (
    !ruledOut &&
    !doubtful &&
    /not expected to practice|unlikely to practice|won'?t practice|will not practice/.test(
      text,
    )
  ) {
    playProbability -= 0.14;
    reasons.push("Expected missed practice time lowers the near-term play estimate.");
  }

  if (
    !ruledOut &&
    !doubtful &&
    !questionable &&
    /may miss (?:time|games?)|could miss (?:time|games?)|expected to miss (?:time|games?)/.test(
      text,
    )
  ) {
    playProbability -= 0.10;
    reasons.push("Reporting that the player may miss time lowers the play estimate.");
  }

  if (
    !ruledOut &&
    /expected to play|likely to play|on track to play|plans to play/.test(text)
  ) {
    playProbability += 0.14;
    reasons.push("Current wording indicates the player is expected to play.");
  }

  if (!ruledOut && /will play|cleared to play|active for the game/.test(text)) {
    playProbability = Math.max(playProbability, 0.985);
    reasons.push("The player has been explicitly cleared or confirmed active.");
  }

  playProbability = clamp(playProbability, 0, 0.995);

  let finishProbabilityIfActive = 0.98;
  if (doubtful) finishProbabilityIfActive -= 0.18;
  else if (questionable) finishProbabilityIfActive -= 0.09;
  else if (probable) finishProbabilityIfActive -= 0.03;

  if (dnpPractice) finishProbabilityIfActive -= 0.07;
  else if (limitedPractice) finishProbabilityIfActive -= 0.04;

  if (gameTimeDecision) finishProbabilityIfActive -= 0.04;

  const softTissue =
    /hamstring|groin|calf|quadriceps|quad|hip|psoas|adductor/.test(text);
  const lowerBodyJoint = /ankle|knee|foot|toe/.test(text);
  const upperBody = /shoulder|rib|ribs|chest|back/.test(text);

  if (softTissue) {
    finishProbabilityIfActive -= 0.07;
    reasons.push("Soft-tissue injuries carry elevated in-game aggravation risk.");
  } else if (lowerBodyJoint) {
    finishProbabilityIfActive -= 0.05;
    reasons.push("Lower-body injuries add some risk of reduced or interrupted usage.");
  } else if (upperBody) {
    finishProbabilityIfActive -= 0.04;
    reasons.push("The injury can still affect workload even if the player starts.");
  }

  const explicitRoleLimit =
    /pitch count|snap count|limited snaps|limited role|reduced role|workload limit/.test(
      text,
    );
  if (explicitRoleLimit) {
    finishProbabilityIfActive -= 0.12;
    reasons.push("An explicit workload limit reduces the chance of a normal full-game role.");
  }

  finishProbabilityIfActive = ruledOut
    ? 0
    : clamp(finishProbabilityIfActive, 0.42, 0.995);

  let expectedUsageIfActive =
    finishProbabilityIfActive +
    (1 - finishProbabilityIfActive) * 0.45;
  if (explicitRoleLimit) expectedUsageIfActive = Math.min(expectedUsageIfActive, 0.72);
  expectedUsageIfActive = clamp(expectedUsageIfActive, 0, 1);

  const fullRoleProbability = playProbability * finishProbabilityIfActive;
  const risk: InjuryRiskLevel =
    playProbability < 0.05
      ? "out"
      : playProbability < 0.55 || fullRoleProbability < 0.5
        ? "high"
        : playProbability < 0.82 || fullRoleProbability < 0.75
          ? "medium"
          : "low";

  const resolvedStatus = ruledOut
    ? "Out"
    : doubtful
      ? "Doubtful"
      : questionable
        ? "Questionable"
        : probable
          ? "Probable"
          : status;

  return {
    status: resolvedStatus,
    detail: signals.detail?.trim() || signals.notes?.trim() || null,
    bodyPart: signals.bodyPart?.trim() || null,
    practiceParticipation: signals.practiceParticipation?.trim() || null,
    playProbability,
    finishProbabilityIfActive,
    fullRoleProbability,
    expectedUsageIfActive,
    risk,
    sources: [...new Set(signals.sources ?? [])],
    reasons,
  };
}
