export async function register() {
  if (
    process.env.NEXT_RUNTIME !== "nodejs" ||
    process.env.NODE_ENV !== "production" ||
    (!process.env.RAILWAY_ENVIRONMENT_NAME && !process.env.RAILWAY_PROJECT_ID)
  ) {
    return;
  }

  const { startRailwayBackgroundJobs } = await import(
    "./lib/background/railway-scheduler"
  );
  startRailwayBackgroundJobs();
}
