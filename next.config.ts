import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  outputFileTracingRoot: process.cwd(),
  // Railway renders the stateful pages that Vercel proxies. Railway-generated
  // HTML must load the exact CSS and JS built by Railway, never the hashes
  // from Vercel's separately compiled frontend.
  assetPrefix:
    process.env.VERCEL !== "1" &&
    (process.env.RAILWAY_SERVICE_ID || process.env.RAILWAY_PUBLIC_DOMAIN)
      ? "https://huddlemark-production.up.railway.app"
      : undefined,
  // Vercel serves the public app. All stateful routes stay on the original
  // Railway service until its SQLite data is intentionally migrated.
  // The Railway worker itself has no VERCEL environment variable, so it never
  // proxies back to itself.
  async rewrites() {
    if (process.env.VERCEL !== "1" || process.env.HUDDLEMARK_NEON_ACTIVE === "1") return [];

    const origin = "https://huddlemark-production.up.railway.app";
    return {
      beforeFiles: [
        { source: "/api/:path*", destination: `${origin}/api/:path*` },
        // These pages read the local production database, or post Server
        // Actions. Proxy the full route so cookies and writes stay coherent.
        ...["account", "results", "sources", "reset-password", "tracker"].map(
          (page) => ({ source: `/${page}`, destination: `${origin}/${page}` }),
        ),
      ],
      afterFiles: [],
      fallback: [],
    };
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
