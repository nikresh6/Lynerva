// The scheduler needs one long-lived production process and persistent storage.
// Vercel/serverless deployments must not start recurring in-process jobs.
export async function register() {
  if (
    process.env.NEXT_RUNTIME !== "nodejs" ||
    process.env.NODE_ENV !== "production" ||
    process.env.VERCEL === "1"
  ) {
    return;
  }

  const railwayHost = Boolean(
    process.env.RAILWAY_ENVIRONMENT_NAME || process.env.RAILWAY_PROJECT_ID
  );
  const enabledOnOtherHost =
    process.env.HUDDLEMARK_ENABLE_BACKGROUND_JOBS === "true";

  if (!railwayHost && !enabledOnOtherHost) return;

  const { startRailwayBackgroundJobs } = await import(
    "./lib/background/railway-scheduler"
  );
  startRailwayBackgroundJobs();
}
