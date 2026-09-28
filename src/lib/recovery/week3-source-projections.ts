import "server-only";

import { createHash } from "node:crypto";
import { getDb } from "@/db";
import { sourceProjections } from "@/db/schema";
import { normalizeLearningPlayer } from "@/lib/model/source-weighting";

type RecoveryPoint = readonly [
  string,
  "passing_yards" | "rushing_yards" | "receiving_yards",
  number,
  string,
];

const WEEK3_RECOVERY: RecoveryPoint[] = [
  ["Michael Penix Jr.","passing_yards",212,"2026-09-25T00:11:00Z"],
  ["Jordan Love","passing_yards",237,"2026-09-25T00:11:00Z"],
  ["Bijan Robinson","rushing_yards",81,"2026-09-25T00:11:00Z"],
  ["Kaleb Johnson","rushing_yards",36,"2026-09-25T00:11:00Z"],
  ["Drake London","receiving_yards",71,"2026-09-25T00:11:00Z"],
  ["Christian Watson","receiving_yards",74,"2026-09-25T00:11:00Z"],

  ["Patrick Mahomes","passing_yards",241,"2026-09-27T06:15:00Z"],
  ["Malik Willis","passing_yards",192,"2026-09-27T06:15:00Z"],
  ["Kenneth Walker III","rushing_yards",86,"2026-09-27T06:15:00Z"],
  ["De'Von Achane","rushing_yards",64,"2026-09-27T06:15:00Z"],
  ["Rashee Rice","receiving_yards",52,"2026-09-27T06:15:00Z"],
  ["Malik Washington","receiving_yards",44,"2026-09-27T06:15:00Z"],

  ["Bryce Young","passing_yards",224,"2026-09-27T09:35:00Z"],
  ["Deshaun Watson","passing_yards",196,"2026-09-27T09:35:00Z"],
  ["Chuba Hubbard","rushing_yards",69,"2026-09-27T09:35:00Z"],
  ["Quinshon Judkins","rushing_yards",59,"2026-09-27T09:35:00Z"],
  ["Tetairoa McMillan","receiving_yards",67,"2026-09-27T09:35:00Z"],
  ["Denzel Boston","receiving_yards",50,"2026-09-27T09:35:00Z"],

  ["Cam Ward","passing_yards",186,"2026-09-27T06:12:00Z"],
  ["Jameis Winston","passing_yards",206,"2026-09-27T06:12:00Z"],
  ["Tony Pollard","rushing_yards",61,"2026-09-27T06:12:00Z"],
  ["Cam Skattebo","rushing_yards",65,"2026-09-27T06:12:00Z"],
  ["Carnell Tate","receiving_yards",44,"2026-09-27T06:12:00Z"],
  ["Malik Nabers","receiving_yards",58,"2026-09-27T06:12:00Z"],

  ["Drake Maye","passing_yards",227,"2026-09-27T06:11:00Z"],
  ["Trevor Lawrence","passing_yards",237,"2026-09-27T06:11:00Z"],
  ["TreVeyon Henderson","rushing_yards",46,"2026-09-27T06:11:00Z"],
  ["Bhayshul Tuten","rushing_yards",56,"2026-09-27T06:11:00Z"],
  ["Romeo Doubs","receiving_yards",47,"2026-09-27T06:11:00Z"],
  ["Parker Washington","receiving_yards",72,"2026-09-27T06:11:00Z"],

  ["Justin Herbert","passing_yards",232,"2026-09-27T06:11:00Z"],
  ["Josh Allen","passing_yards",245,"2026-09-27T06:11:00Z"],
  ["Omarion Hampton","rushing_yards",62,"2026-09-27T06:11:00Z"],
  ["James Cook","rushing_yards",86,"2026-09-27T06:11:00Z"],
  ["Ladd McConkey","receiving_yards",64,"2026-09-27T06:11:00Z"],
  ["Dalton Kincaid","receiving_yards",59,"2026-09-27T06:11:00Z"],

  ["Geno Smith","passing_yards",226,"2026-09-27T08:35:00Z"],
  ["Jared Goff","passing_yards",258,"2026-09-27T08:35:00Z"],
  ["Breece Hall","rushing_yards",62,"2026-09-27T08:35:00Z"],
  ["Jahmyr Gibbs","rushing_yards",93,"2026-09-27T08:35:00Z"],
  ["Garrett Wilson","receiving_yards",79,"2026-09-27T08:35:00Z"],
  ["Amon-Ra St. Brown","receiving_yards",83,"2026-09-27T08:35:00Z"],

  ["C.J. Stroud","passing_yards",239,"2026-09-27T06:15:00Z"],
  ["Daniel Jones","passing_yards",216,"2026-09-27T06:15:00Z"],
  ["David Montgomery","rushing_yards",53,"2026-09-27T06:15:00Z"],
  ["Jonathan Taylor","rushing_yards",83,"2026-09-27T06:15:00Z"],
  ["Dalton Schultz","receiving_yards",52,"2026-09-27T06:15:00Z"],
  ["Josh Downs","receiving_yards",55,"2026-09-27T06:15:00Z"],

  ["Sam Darnold","passing_yards",221,"2026-09-27T06:15:00Z"],
  ["Marcus Mariota","passing_yards",186,"2026-09-27T06:15:00Z"],
  ["Jadarian Price","rushing_yards",59,"2026-09-27T06:15:00Z"],
  ["Jacory Croskey-Merritt","rushing_yards",41,"2026-09-27T06:15:00Z"],
  ["Jaxon Smith-Njigba","receiving_yards",94,"2026-09-27T06:15:00Z"],
  ["Terry McLaurin","receiving_yards",47,"2026-09-27T06:15:00Z"],

  ["Ja'Marr Chase","receiving_yards",78.9,"2026-09-25T16:39:00Z"],

  ["Kyler Murray","passing_yards",213,"2026-09-27T12:26:00Z"],
  ["Baker Mayfield","passing_yards",216,"2026-09-27T12:26:00Z"],
  ["Aaron Jones","rushing_yards",55,"2026-09-27T12:26:00Z"],
  ["Bucky Irving","rushing_yards",58,"2026-09-27T12:26:00Z"],
  ["Justin Jefferson","receiving_yards",77,"2026-09-27T12:26:00Z"],
  ["Emeka Egbuka","receiving_yards",54,"2026-09-27T12:26:00Z"],

  ["Kirk Cousins","passing_yards",218,"2026-09-27T09:21:00Z"],
  ["Tyler Shough","passing_yards",255,"2026-09-27T09:21:00Z"],
  ["Ashton Jeanty","rushing_yards",68,"2026-09-27T09:21:00Z"],
  ["Travis Etienne Jr.","rushing_yards",45,"2026-09-27T09:21:00Z"],
  ["Brock Bowers","receiving_yards",47,"2026-09-27T09:21:00Z"],
  ["Chris Olave","receiving_yards",81,"2026-09-27T09:21:00Z"],

  ["Lamar Jackson","passing_yards",245,"2026-09-27T12:26:00Z"],
  ["Dak Prescott","passing_yards",278,"2026-09-27T12:26:00Z"],
  ["Derrick Henry","rushing_yards",93,"2026-09-27T12:26:00Z"],
  ["Javonte Williams","rushing_yards",62,"2026-09-27T12:26:00Z"],
  ["Zay Flowers","receiving_yards",64,"2026-09-27T12:26:00Z"],
  ["CeeDee Lamb","receiving_yards",86,"2026-09-27T12:26:00Z"],

  ["Jacoby Brissett","passing_yards",233,"2026-09-27T20:05:00Z"],
  ["Brock Purdy","passing_yards",241,"2026-09-27T20:05:00Z"],
  ["Jeremiyah Love","rushing_yards",46,"2026-09-27T20:05:00Z"],
  ["Christian McCaffrey","rushing_yards",64,"2026-09-27T20:05:00Z"],
  ["Trey McBride","receiving_yards",69,"2026-09-27T20:05:00Z"],
  ["Mike Evans","receiving_yards",58,"2026-09-27T20:05:00Z"],
];

function stableProjectionId(playerName: string, statistic: string) {
  const playerKey = normalizeLearningPlayer(playerName);
  const key = `2026:3:${playerKey}:${statistic}:dimers`;
  const hex = createHash("sha256").update(key).digest("hex");
  return `source_projection_${hex.slice(0, 24)}`;
}

let recoveryPromise: Promise<number> | null = null;

export function applyWeek3ProjectionRecovery() {
  if (recoveryPromise) return recoveryPromise;
  recoveryPromise = (async () => {
    const db = getDb();
    const rows = WEEK3_RECOVERY.map(
      ([playerName, statistic, projectedValue, captured]) => {
        const playerKey = normalizeLearningPlayer(playerName);
        const capturedAt = new Date(captured);
        return {
          id: stableProjectionId(playerName, statistic),
          season: 2026,
          week: 3,
          playerName,
          playerKey,
          statistic,
          source: "dimers",
          projectedValue,
          capturedAt,
          latestProjectedValue: projectedValue,
          latestCapturedAt: capturedAt,
          observationCount: 1,
        };
      },
    );

    for (let index = 0; index < rows.length; index += 100) {
      await db
        .insert(sourceProjections)
        .values(rows.slice(index, index + 100))
        .onConflictDoNothing({ target: sourceProjections.id });
    }

    console.info("[recovery] Week 3 verified Dimers rows seeded", rows.length);
    return rows.length;
  })().catch((error) => {
    recoveryPromise = null;
    throw error;
  });
  return recoveryPromise;
}
