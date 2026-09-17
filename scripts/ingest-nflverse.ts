import { ingestNflverseSeason } from "../src/lib/nfl/nflverse";

const season = Number(process.argv[2] ?? new Date().getUTCFullYear());

ingestNflverseSeason(season)
  .then((result) => {
    console.log(JSON.stringify(result, null, 2));
  })
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
