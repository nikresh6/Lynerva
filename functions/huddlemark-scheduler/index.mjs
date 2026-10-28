// Neon Function Triggers replace Railway's always-on background scheduler.
// Each scheduled invocation posts to this function with Neon trigger metadata.
// No public caller may invoke a job without that signed platform context.
const routes = new Map([
  ["/scorecards", "/api/cron/scorecards"],
  ["/grading", "/api/cron/grading"],
  ["/markets", "/api/cron/markets"],
  ["/nflverse", "/api/cron/nflverse"],
]);
export default {
  async fetch(request) {
    const url = new URL(request.url);
    const route = routes.get(url.pathname);
    if (!route || request.method !== "POST" || !request.headers.get("X-Neon-Trigger-Invocation-Id")) {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }
    console.info("[huddlemark-scheduler] invoked", url.pathname);
    const origin = process.env.HUDDLEMARK_ORIGIN;
    const secret = process.env.CRON_SECRET;
    if (!origin || !secret) return Response.json({ error: "Scheduler not configured" }, { status: 503 });
    try {
      const destination = new URL(route, origin);
      // Private preview deployments can supply a short-lived Vercel share
      // token in their origin URL. Production does not need one.
      const shareToken = new URL(origin).searchParams.get("_vercel_share");
      if (shareToken) destination.searchParams.set("_vercel_share", shareToken);
      const reply = await fetch(destination, {
        headers: { Authorization: `Bearer ${secret}` },
        signal: AbortSignal.timeout(90_000),
      });
      if (!reply.ok) {
        console.error("[huddlemark-scheduler] failed", route, reply.status);
        return Response.json({ ok: false, job: route, status: reply.status }, { status: 502 });
      }
      console.info("[huddlemark-scheduler] succeeded", route, reply.status);
      return Response.json({ ok: true, job: route, status: reply.status });
    } catch (error) {
      console.error("[huddlemark-scheduler] connection failure", route, error);
      return Response.json({ error: "Job failed", job: route }, { status: 502 });
    }
  },
};
