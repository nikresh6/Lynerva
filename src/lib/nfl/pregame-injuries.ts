import "server-only";

import { z } from "zod";
import {
  estimateInjuryAvailability,
  type InjuryAvailabilityEstimate,
} from "@/lib/model/injury-availability";
import { getEspnPlayerInjuryState } from "./live-player-stats";
import { getInjuryNewsSignal } from "./injury-news";

const sleeperPlayerSchema = z
  .object({
    player_id: z.string().optional(),
    full_name: z.string().nullable().optional(),
    first_name: z.string().nullable().optional(),
    last_name: z.string().nullable().optional(),
    team: z.string().nullable().optional(),
    status: z.string().nullable().optional(),
    injury_status: z.string().nullable().optional(),
    injury_body_part: z.string().nullable().optional(),
    injury_start_date: z.string().nullable().optional(),
    injury_notes: z.string().nullable().optional(),
    practice_participation: z.string().nullable().optional(),
    practice_description: z.string().nullable().optional(),
  })
  .passthrough();

const sleeperPlayersSchema = z.record(z.string(), sleeperPlayerSchema);

type SleeperPlayer = z.infer<typeof sleeperPlayerSchema>;

const SLEEPER_TTL_MS = 6 * 60 * 60_000;
const SLEEPER_RETRY_BACKOFF_MS = 10 * 60_000;
const AVAILABILITY_TTL_MS = 90_000;
let sleeperCache:
  | {
      storedAt: number;
      byName: Map<string, SleeperPlayer>;
    }
  | null = null;
let sleeperInflight: Promise<Map<string, SleeperPlayer>> | null = null;
let sleeperRetryAfter = 0;
let sleeperFailureLoggedAt = 0;
const availabilityCache = new Map<
  string,
  {
    expiresAt: number;
    promise: Promise<PregamePlayerAvailability | null>;
  }
>();

function normalizePerson(value: string) {
  return value
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/\b(jr|sr|ii|iii|iv)\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function sleeperName(player: SleeperPlayer) {
  return (
    player.full_name ??
    [player.first_name, player.last_name].filter(Boolean).join(" ")
  );
}

async function loadSleeperPlayers() {
  if (sleeperCache && Date.now() - sleeperCache.storedAt < SLEEPER_TTL_MS) {
    return sleeperCache.byName;
  }
  if (sleeperInflight) return sleeperInflight;
  if (Date.now() < sleeperRetryAfter) {
    return sleeperCache?.byName ?? new Map<string, SleeperPlayer>();
  }

  sleeperInflight = (async () => {
    const response = await fetch(
      "https://api.sleeper.app/v1/players/nfl?active=true",
      {
        headers: {
          Accept: "application/json",
          "User-Agent": "Huddlemark/1.0 market-research",
        },
        cache: "no-store",
        signal: AbortSignal.timeout(2_500),
      },
    );
    if (!response.ok) {
      throw new Error("Sleeper players returned " + response.status);
    }

    const payload: unknown = await response.json();
    const parsed = sleeperPlayersSchema.safeParse(payload);
    if (!parsed.success) {
      throw new Error("Sleeper player injury response shape changed");
    }

    const byName = new Map<string, SleeperPlayer>();
    for (const player of Object.values(parsed.data)) {
      const name = normalizePerson(sleeperName(player));
      if (!name) continue;
      const existing = byName.get(name);
      if (!existing || (!existing.team && player.team)) {
        byName.set(name, player);
      }
    }

    sleeperCache = { storedAt: Date.now(), byName };
    sleeperRetryAfter = 0;
    return byName;
  })()
    .catch((error) => {
      sleeperRetryAfter = Date.now() + SLEEPER_RETRY_BACKOFF_MS;
      if (Date.now() - sleeperFailureLoggedAt > SLEEPER_RETRY_BACKOFF_MS) {
        sleeperFailureLoggedAt = Date.now();
        console.warn(
          "Sleeper injury feed unavailable; using ESPN/news only until retry window.",
          error instanceof Error ? error.message : String(error),
        );
      }
      return sleeperCache?.byName ?? new Map<string, SleeperPlayer>();
    })
    .finally(() => {
      sleeperInflight = null;
    });

  return sleeperInflight;
}

async function getSleeperPlayerInjury(subject: string) {
  try {
    const player = (await loadSleeperPlayers()).get(normalizePerson(subject));
    if (!player) return null;

    const meaningful = Boolean(
      player.injury_status ||
        player.injury_body_part ||
        player.injury_notes ||
        player.practice_participation ||
        player.practice_description,
    );
    if (!meaningful) return null;

    return {
      status: player.injury_status ?? null,
      bodyPart: player.injury_body_part ?? null,
      notes: player.injury_notes ?? null,
      practiceParticipation: player.practice_participation ?? null,
      practiceDescription: player.practice_description ?? null,
    };
  } catch {
    // Sleeper is optional enrichment. The shared loader handles backoff and
    // rate-limited logging, so a provider outage must never spam one error per
    // player or block the prop board.
    return null;
  }
}

export interface PregamePlayerAvailability extends InjuryAvailabilityEstimate {
  espnStatus: string | null;
  sleeperStatus: string | null;
  newsPublishedAt: string | null;
  newsText: string | null;
}

async function computePregamePlayerAvailability(input: {
  subject: string;
  espnGameId?: string | null;
}): Promise<PregamePlayerAvailability | null> {
  const [espn, sleeper, news] = await Promise.all([
    input.espnGameId
      ? getEspnPlayerInjuryState(input.espnGameId, input.subject)
      : Promise.resolve(null),
    getSleeperPlayerInjury(input.subject),
    getInjuryNewsSignal(input.subject).catch(() => null),
  ]);

  if (!espn && !sleeper && !news) return null;

  const sources = [
    ...(espn ? ["ESPN"] : []),
    ...(sleeper ? ["Sleeper"] : []),
    ...(news?.sources ?? []),
  ];

  const estimate = estimateInjuryAvailability({
    status: espn?.status ?? sleeper?.status ?? null,
    detail: espn?.detail ?? null,
    bodyPart: espn?.bodyPart ?? sleeper?.bodyPart ?? null,
    notes: sleeper?.notes ?? null,
    practiceParticipation: sleeper?.practiceParticipation ?? null,
    practiceDescription: sleeper?.practiceDescription ?? null,
    news: news?.text ?? null,
    sources,
  });

  if (!estimate) return null;

  return {
    ...estimate,
    espnStatus: espn?.status ?? null,
    sleeperStatus: sleeper?.status ?? null,
    newsPublishedAt: news?.publishedAt ?? null,
    newsText: news?.text ?? null,
  };
}

export function getPregamePlayerAvailability(input: {
  subject: string;
  espnGameId?: string | null;
}): Promise<PregamePlayerAvailability | null> {
  const key =
    normalizePerson(input.subject) + ":" + (input.espnGameId ?? "no-game");
  const cached = availabilityCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.promise;

  const promise = computePregamePlayerAvailability(input);
  availabilityCache.set(key, {
    expiresAt: Date.now() + AVAILABILITY_TTL_MS,
    promise,
  });
  promise.catch(() => availabilityCache.delete(key));
  return promise;
}
