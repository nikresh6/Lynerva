import "dotenv/config";

import { recoverOutageWeek } from "../src/lib/recovery/week";

async function main() {
  const season = Number(process.argv[2] ?? "2026");
  const week = Number(process.argv[3] ?? "3");
  if (!Number.isInteger(season) || !Number.isInteger(week)) {
    throw new Error("Usage: npm run recovery:week -- <season> <week>");
  }
  const result = await recoverOutageWeek(season, week);
  console.log(
    JSON.stringify(
      {
        ...result,
        note:
          "Recovered rows are tagged recovered_post_outage and learningEligible=false, so they cannot influence source weights.",
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
