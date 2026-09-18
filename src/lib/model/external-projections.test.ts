import { describe, expect, it } from "vitest";

function normalizePerson(value: string) {
  return value
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/\b(jr|sr|ii|iii|iv)\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function namesMatch(candidate: string, target: string) {
  const left = normalizePerson(candidate).split(" ").filter(Boolean);
  const right = normalizePerson(target).split(" ").filter(Boolean);
  if (!left.length || !right.length) return false;
  if (left.join(" ") === right.join(" ")) return true;
  const abbreviated = (shorter: string[], longer: string[]) =>
    shorter.length === 2 &&
    longer.length >= 2 &&
    shorter[0]?.length === 1 &&
    shorter[0] === longer[0]?.[0] &&
    shorter.at(-1) === longer.at(-1);
  return abbreviated(left, right) || abbreviated(right, left);
}

function resolveProjectionPlayer<T>(entries: Array<[string, T]>, subject: string) {
  const target = normalizePerson(subject);
  const exact = entries.find(([name]) => normalizePerson(name) === target);
  if (exact) return exact[1];
  const matches = entries.filter(([name]) => namesMatch(name, subject));
  return matches.length === 1 ? matches[0]?.[1] ?? null : null;
}

describe("projection player resolution", () => {
  it("keeps Brian Robinson Jr. separate from Bijan Robinson", () => {
    const entries: Array<[string, { rushingYards: number }]> = [
      ["Bijan Robinson", { rushingYards: 90.6 }],
      ["Brian Robinson Jr.", { rushingYards: 30.0 }],
    ];
    expect(resolveProjectionPlayer(entries, "Brian Robinson Jr.")).toEqual({
      rushingYards: 30.0,
    });
  });

  it("rejects an ambiguous initial-and-last-name lookup", () => {
    const entries: Array<[string, { rushingYards: number }]> = [
      ["Bijan Robinson", { rushingYards: 80.7 }],
      ["Brian Robinson Jr.", { rushingYards: 30.0 }],
    ];
    expect(resolveProjectionPlayer(entries, "B. Robinson")).toBeNull();
  });
});
