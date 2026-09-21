import "server-only";

import { z } from "zod";

export interface InjuryNewsSignal {
  text: string;
  publishedAt: string | null;
  sources: string[];
}

const CACHE_TTL_MS = 2 * 60_000;
const FETCH_TIMEOUT_MS = 2_500;

let fantasyProsCache:
  | { storedAt: number; text: string }
  | null = null;
let fantasyProsInflight: Promise<string> | null = null;
let espnCache:
  | { storedAt: number; articles: EspnArticle[] }
  | null = null;
let espnInflight: Promise<EspnArticle[]> | null = null;

const espnArticleSchema = z
  .object({
    headline: z.string().optional(),
    description: z.string().optional(),
    published: z.string().optional(),
    lastModified: z.string().optional(),
  })
  .passthrough();

const espnNewsSchema = z
  .object({
    articles: z.array(espnArticleSchema).default([]),
  })
  .passthrough();

type EspnArticle = z.infer<typeof espnArticleSchema>;

function normalizePerson(value: string) {
  return value
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/\b(jr|sr|ii|iii|iv)\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function decodeHtml(value: string) {
  return value
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/&#x27;/gi, "'")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function injuryRelevant(value: string) {
  return /\b(?:injur|questionable|doubtful|inactive|ruled out|will not play|won't play|not expected to play|unlikely to play|expected to play|likely to play|game[- ]time decision|trending|limited|practice|hamstring|groin|hip|knee|ankle|foot|shoulder|back|rib|calf|quad|concussion|illness|ir\b|injured reserve)\b/i.test(
    value,
  );
}

function subjectAppears(value: string, subject: string) {
  const haystack = normalizePerson(value);
  const target = normalizePerson(subject);
  if (!target) return false;
  if (haystack.includes(target)) return true;

  const parts = target.split(" ").filter(Boolean);
  const last = parts.at(-1);
  return Boolean(last && last.length >= 5 && haystack.includes(last));
}

async function loadFantasyProsText() {
  if (
    fantasyProsCache &&
    Date.now() - fantasyProsCache.storedAt < CACHE_TTL_MS
  ) {
    return fantasyProsCache.text;
  }
  if (fantasyProsInflight) return fantasyProsInflight;

  fantasyProsInflight = (async () => {
    const response = await fetch(
      "https://www.fantasypros.com/nfl/injury-news.php",
      {
        cache: "no-store",
        headers: {
          Accept: "text/html",
          "User-Agent": "Huddlemark/1.0 injury-news",
        },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      },
    );
    if (!response.ok) {
      throw new Error("FantasyPros injury news returned " + response.status);
    }

    const text = decodeHtml(await response.text());
    fantasyProsCache = { storedAt: Date.now(), text };
    return text;
  })().finally(() => {
    fantasyProsInflight = null;
  });

  return fantasyProsInflight;
}

async function loadEspnArticles() {
  if (espnCache && Date.now() - espnCache.storedAt < CACHE_TTL_MS) {
    return espnCache.articles;
  }
  if (espnInflight) return espnInflight;

  espnInflight = (async () => {
    const response = await fetch(
      "https://site.api.espn.com/apis/site/v2/sports/football/nfl/news?limit=100",
      {
        cache: "no-store",
        headers: {
          Accept: "application/json",
          "User-Agent": "Huddlemark/1.0 injury-news",
        },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      },
    );
    if (!response.ok) {
      throw new Error("ESPN NFL news returned " + response.status);
    }

    const parsed = espnNewsSchema.safeParse(await response.json());
    if (!parsed.success) {
      throw new Error("ESPN NFL news response shape changed");
    }

    espnCache = { storedAt: Date.now(), articles: parsed.data.articles };
    return parsed.data.articles;
  })().finally(() => {
    espnInflight = null;
  });

  return espnInflight;
}

function fantasyProsSnippet(text: string, subject: string) {
  const normalizedSubject = normalizePerson(subject);
  if (!normalizedSubject || !normalizePerson(text).includes(normalizedSubject)) {
    return null;
  }

  const lastRaw = subject.trim().split(/\s+/).at(-1) ?? "";
  const last = lastRaw.replace(/[.*+?^$(){}|[\]\\]/g, "\\$&");
  const originalIndex = last
    ? text.search(new RegExp("\\b" + last + "\\b", "i"))
    : -1;
  if (originalIndex < 0) return null;

  const start = Math.max(0, originalIndex - 120);
  const snippet = text.slice(start, start + 900).trim();
  return subjectAppears(snippet, subject) && injuryRelevant(snippet)
    ? snippet
    : null;
}

function parseFantasyProsTime(value: string) {
  const match = value.match(
    /(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun),\s+([A-Z][a-z]{2})\s+(\d{1,2})(?:st|nd|rd|th)?\s+(\d{1,2}):(\d{2})(am|pm)\s+(EDT|EST|CDT|CST|MDT|MST|PDT|PST)/i,
  );
  if (!match) return null;

  const months: Record<string, number> = {
    Jan: 0,
    Feb: 1,
    Mar: 2,
    Apr: 3,
    May: 4,
    Jun: 5,
    Jul: 6,
    Aug: 7,
    Sep: 8,
    Oct: 9,
    Nov: 10,
    Dec: 11,
  };
  const offsets: Record<string, number> = {
    EDT: -4,
    EST: -5,
    CDT: -5,
    CST: -6,
    MDT: -6,
    MST: -7,
    PDT: -7,
    PST: -8,
  };

  const month = months[match[1] ?? ""];
  const offset = offsets[(match[6] ?? "").toUpperCase()];
  if (month === undefined || offset === undefined) return null;

  let hour = Number(match[3]);
  const minute = Number(match[4]);
  const ampm = (match[5] ?? "").toLowerCase();
  if (ampm === "pm" && hour < 12) hour += 12;
  if (ampm === "am" && hour === 12) hour = 0;

  const year = new Date().getUTCFullYear();
  const utc = Date.UTC(year, month, Number(match[2]), hour - offset, minute);
  return Number.isFinite(utc) ? new Date(utc).toISOString() : null;
}

export async function getInjuryNewsSignal(
  subject: string,
): Promise<InjuryNewsSignal | null> {
  const [fantasyProsResult, espnResult] = await Promise.allSettled([
    loadFantasyProsText(),
    loadEspnArticles(),
  ]);

  const texts: string[] = [];
  const sources: string[] = [];
  let publishedAt: string | null = null;

  if (fantasyProsResult.status === "fulfilled") {
    const snippet = fantasyProsSnippet(fantasyProsResult.value, subject);
    if (snippet) {
      texts.push(snippet);
      sources.push("FantasyPros News");
      publishedAt = parseFantasyProsTime(snippet);
    }
  }

  if (espnResult.status === "fulfilled") {
    const matching = espnResult.value
      .filter((article) => {
        const text = [article.headline, article.description]
          .filter(Boolean)
          .join(" ");
        return subjectAppears(text, subject) && injuryRelevant(text);
      })
      .toSorted((first, second) => {
        const left = Date.parse(first.published ?? first.lastModified ?? "") || 0;
        const right = Date.parse(second.published ?? second.lastModified ?? "") || 0;
        return right - left;
      })
      .slice(0, 2);

    for (const article of matching) {
      const text = [article.headline, article.description]
        .filter(Boolean)
        .join(". ")
        .trim();
      if (text) texts.push(text);
      if (!sources.includes("ESPN News")) sources.push("ESPN News");

      const candidate = article.published ?? article.lastModified ?? null;
      if (candidate) {
        const candidateTime = Date.parse(candidate);
        const currentTime = publishedAt ? Date.parse(publishedAt) : 0;
        if (Number.isFinite(candidateTime) && candidateTime > currentTime) {
          publishedAt = new Date(candidateTime).toISOString();
        }
      }
    }
  }

  if (!texts.length) return null;

  return {
    text: texts.join(" · ").slice(0, 2_400),
    publishedAt,
    sources,
  };
}
