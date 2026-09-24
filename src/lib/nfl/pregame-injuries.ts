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

const espnLeagueInjuryItemSchema = z
  .object({
    athlete: z
      .object({
        fullName: z.string().optional(),
        displayName: z.string().optional(),
        shortName: z.string().optional(),
      })
      .passthrough()
      .optional(),
    status: z.string().optional(),
    detail: z.string().optional(),
    type: z
      .object({
        name: z.string().optional(),
        description: z.string().optional(),
        abbreviation: z.string().optional(),
      })
      .passthrough()
      .optional(),
    details: z
      .object({
        type: z.string().optional(),
        detail: z.string().optional(),
        returnDate: z.string().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

const espnLeagueInjurySchema = z
  .object({
    injuries: z
      .array(
        z
          .object({
            team: z
              .object({
                abbreviation: z.string().optional(),
              })
              .passthrough()
              .optional(),
            injuries: z.array(espnLeagueInjuryItemSchema).default([]),
          })
          .passthrough(),
      )
      .default([]),
  })
  .passthrough();

type EspnLeagueInjuryItem = z.infer<typeof espnLeagueInjuryItemSchema>;

const SLEEPER_TTL_MS = 6 * 60 * 60_000;
const SLEEPER_RETRY_BACKOFF_MS = 10 * 60_000;
const ESPN_INJURY_TTL_MS = 60_000;
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
let espnLeagueInjuryCache:
  | {
      storedAt: number;
      byName: Map<string, EspnLeagueInjuryItem>;
    }
  | null = null;
let espnLeagueInjuryInflight:
  | Promise<Map<string, EspnLeagueInjuryItem>>
  | null = null;
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

function espnLeagueInjuryName(player: EspnLeagueInjuryItem) {
  return (
    player.athlete?.fullName ??
    player.athlete?.displayName ??
    player.athlete?.shortName ??
    ""
  );
}

function statusLikeInjuryValue(value: string | null | undefined) {
  if (!value) return false;
  return /^(?:active|healthy|available|injury_status_[a-z_]+|questionable|doubtful|out|probable|inactive)$/i.test(
    value.trim(),
  );
}

async function loadEspnLeagueInjuries() {
  if (
    espnLeagueInjuryCache &&
    Date.now() - espnLeagueInjuryCache.storedAt < ESPN_INJURY_TTL_MS
  ) {
    return espnLeagueInjuryCache.byName;
  }
  if (espnLeagueInjuryInflight) return espnLeagueInjuryInflight;

  espnLeagueInjuryInflight = (async () => {
    const response = await fetch(
      "https://site.api.espn.com/apis/site/v2/sports/football/nfl/injuries",
      {
        cache: "no-store",
        headers: {
          Accept: "application/json",
          "User-Agent": "Huddlemark/1.0 injury-report",
        },
        signal: AbortSignal.timeout(2_500),
      },
    );
    if (!response.ok) {
      throw new Error("ESPN league injury report returned " + response.status);
    }

    const parsed = espnLeagueInjurySchema.safeParse(await response.json());
    if (!parsed.success) {
      throw new Error("ESPN league injury report response shape changed");
    }

    const byName = new Map<string, EspnLeagueInjuryItem>();
    for (const group of parsed.data.injuries) {
      for (const injury of group.injuries) {
        const name = normalizePerson(espnLeagueInjuryName(injury));
        if (!name) continue;
        byName.set(name, injury);
      }
    }

    espnLeagueInjuryCache = { storedAt: Date.now(), byName };
    return byName;
  })()
    .catch(() => espnLeagueInjuryCache?.byName ?? new Map<string, EspnLeagueInjuryItem>())
    .finally(() => {
      espnLeagueInjuryInflight = null;
    });

  return espnLeagueInjuryInflight;
}

async function getEspnLeaguePlayerInjury(subject: string) {
  const injury = (await loadEspnLeagueInjuries()).get(normalizePerson(subject));
  if (!injury) return null;

  const status = injury.status ?? injury.type?.description ?? null;
  const rawDetail = injury.details?.detail ?? injury.detail ?? null;
  const rawBodyPart = injury.details?.type ?? injury.type?.name ?? null;
  const detail =
    rawDetail && !statusLikeInjuryValue(rawDetail) ? rawDetail : null;
  const bodyPart =
    rawBodyPart && !statusLikeInjuryValue(rawBodyPart) ? rawBodyPart : null;

  // ESPN can include healthy roster entries in this endpoint with values such
  // as "Active" and "INJURY_STATUS_ACTIVE". Those are roster-state
  // boilerplate, not evidence of an injury, and must not create a fake 92%
  // availability estimate.
  const healthyOnly =
    Boolean(status && /^(?:active|healthy|available|injury_status_active)$/i.test(status.trim())) &&
    !detail &&
    !bodyPart;
  if (healthyOnly || (!status && !detail && !bodyPart)) return null;

  return {
    status,
    detail,
    bodyPart,
  };
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
  // Sleeper's all-NFL player endpoint is a very large JSON document. Parsing
  // it inside the request-time market build can push the Next.js process over
  // its V8 heap limit. ESPN and attributed injury news remain the primary
  // request-time sources; Sleeper can be re-enabled explicitly after it is
  // moved to a background ingestion job.
  if (process.env.ENABLE_SLEEPER_INJURIES !== "true") return null;

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
  const [espnGame, espnLeague, sleeper, news] = await Promise.all([
    input.espnGameId
      ? getEspnPlayerInjuryState(input.espnGameId, input.subject)
      : Promise.resolve(null),
    getEspnLeaguePlayerInjury(input.subject).catch(() => null),
    getSleeperPlayerInjury(input.subject),
    getInjuryNewsSignal(input.subject).catch(() => null),
  ]);

  if (!espnGame && !espnLeague && !sleeper && !news) return null;

  const sources = [
    ...(espnLeague ? ["ESPN Injury Report"] : []),
    ...(espnGame ? ["ESPN Game"] : []),
    ...(sleeper ? ["Sleeper"] : []),
    ...(news?.sources ?? []),
  ];

  // Prefer ESPN's league-wide injury report because it is tied to the current
  // week and does not depend on whether the upcoming game summary has already
  // populated its injury block. The game summary remains a useful secondary
  // source for detail/body-part context.
  const estimate = estimateInjuryAvailability({
    status:
      espnLeague?.status ??
      espnGame?.status ??
      sleeper?.status ??
      null,
    detail:
      espnLeague?.detail ??
      espnGame?.detail ??
      null,
    bodyPart:
      espnLeague?.bodyPart ??
      espnGame?.bodyPart ??
      sleeper?.bodyPart ??
      null,
    notes: sleeper?.notes ?? null,
    practiceParticipation: sleeper?.practiceParticipation ?? null,
    practiceDescription: sleeper?.practiceDescription ?? null,
    news: news?.text ?? null,
    sources,
  });

  if (!estimate) return null;

  return {
    ...estimate,
    espnStatus: espnLeague?.status ?? espnGame?.status ?? null,
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
