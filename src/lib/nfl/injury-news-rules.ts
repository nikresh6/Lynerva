function normalizePerson(value: string) {
  return value
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/\b(jr|sr|ii|iii|iv)\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function injuryRelevant(value: string) {
  return /\b(?:injur|questionable|doubtful|inactive|ruled out|will not play|won't play|not expected to play|unlikely to play|expected to play|likely to play|game[- ]time decision|trending|limited|practice|hamstring|groin|hip|knee|ankle|foot|shoulder|back|rib|calf|quad|concussion|illness|ir\b|injured reserve)\b/i.test(
    value,
  );
}

function fullNamePattern(subject: string) {
  const parts = normalizePerson(subject).split(" ").filter(Boolean);
  if (parts.length < 2) return null;
  const escaped = parts.map((part) =>
    part.replace(/[.*+?^$(){}|[\]\\]/g, "\\$&"),
  );
  return new RegExp("\\b" + escaped.join("[\\s.'’_-]+") + "\\b", "i");
}

function sentenceLikeChunks(value: string) {
  return value
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+|\s+[•·|]\s+|\s{2,}/)
    .map((chunk) => chunk.trim())
    .filter(Boolean);
}

/**
 * Return injury language only when it is attributable to the named player.
 * Whole-article matching caused healthy players mentioned near an injured
 * teammate to inherit that teammate's "out/questionable" language.
 */
export function attributedInjurySnippet(
  value: string,
  subject: string,
): string | null {
  const pattern = fullNamePattern(subject);
  if (!pattern) return null;

  const chunks = sentenceLikeChunks(value);
  for (const chunk of chunks) {
    if (pattern.test(chunk) && injuryRelevant(chunk)) return chunk;
  }

  // Some feeds flatten status cards without sentence punctuation. In that
  // case allow a tight local window around the exact full-name mention, but
  // never fall back to a last-name-only match.
  const match = pattern.exec(value);
  if (!match || match.index === undefined) return null;
  const start = Math.max(0, match.index - 90);
  const end = Math.min(value.length, match.index + match[0].length + 180);
  const local = value.slice(start, end).replace(/\s+/g, " ").trim();
  return injuryRelevant(local) ? local : null;
}
