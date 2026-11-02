// The Render/Vercel recovery deployment intentionally does not start the
// legacy Railway in-process scheduler. Scheduled work is disabled until the
// database, quotas and independent job runner are verified.
export async function register() {
  // No background jobs on this web process.
}
