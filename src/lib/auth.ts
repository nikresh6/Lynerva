import "server-only";

import { betterAuth } from "better-auth/minimal";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { Resend } from "resend";
import { getDb } from "@/db";
import * as schema from "@/db/schema";

function normalizeOrigin(value: string | undefined) {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  const withProtocol = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;

  try {
    return new URL(withProtocol).origin;
  } catch {
    return null;
  }
}

const LYNERVA_PRODUCTION_ORIGIN = "https://lynerva-production.up.railway.app";

function resolveAuthOrigin() {
  const railwayOrigin = normalizeOrigin(process.env.RAILWAY_PUBLIC_DOMAIN);
  const configuredOrigin = normalizeOrigin(process.env.BETTER_AUTH_URL);

  if (process.env.NODE_ENV === "production") {
    // BETTER_AUTH_URL is the explicitly configured canonical origin. Prefer it
    // over Railway's inferred domain so cookies and callback URLs do not change
    // if Railway exposes a different public-domain value during a deployment.
    return configuredOrigin ?? railwayOrigin ?? LYNERVA_PRODUCTION_ORIGIN;
  }

  return configuredOrigin ?? railwayOrigin ?? undefined;
}

function createAuth() {
  const resend = process.env.RESEND_API_KEY
    ? new Resend(process.env.RESEND_API_KEY)
    : null;
  const baseURL = resolveAuthOrigin();
  const trustedOrigins = [
    baseURL,
    normalizeOrigin(process.env.BETTER_AUTH_URL),
    normalizeOrigin(process.env.RAILWAY_PUBLIC_DOMAIN),
    LYNERVA_PRODUCTION_ORIGIN,
  ].filter((value): value is string => Boolean(value));

  return betterAuth({
    appName: "Lynerva",
    baseURL,
    trustedOrigins: [...new Set(trustedOrigins)],
    secret: process.env.BETTER_AUTH_SECRET,
    database: drizzleAdapter(getDb(), {
      provider: "sqlite",
      schema,
    }),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 10,
      maxPasswordLength: 128,
      revokeSessionsOnPasswordReset: true,
      resetPasswordTokenExpiresIn: 3_600,
      sendResetPassword: async ({ user, url }) => {
        if (!resend || !process.env.EMAIL_FROM) {
          console.warn("Password reset email skipped: Resend is not configured.");
          return;
        }

        const { error } = await resend.emails.send({
          from: process.env.EMAIL_FROM,
          to: user.email,
          subject: "Reset your Lynerva password",
          text: `Reset your Lynerva password: ${url}\n\nThis link expires in one hour. If you did not request it, you can ignore this email.`,
          html: `<p>Reset your Lynerva password using the link below.</p><p><a href="${url}">Reset password</a></p><p>This link expires in one hour. If you did not request it, you can ignore this email.</p>`,
        });

        if (error) throw new Error(`Resend failed: ${error.message}`);
      },
    },
    session: {
      expiresIn: 60 * 60 * 24 * 30,
      updateAge: 60 * 60 * 24,
      cookieCache: {
        enabled: true,
        maxAge: 5 * 60,
      },
    },
    advanced: {
      // Better Auth's Drizzle join mode requires explicit Drizzle relations.
      // Lynerva's schema currently defines foreign keys but not relation objects,
      // so use the adapter's safe multi-query path instead.
      database: { joins: false },
      cookiePrefix: "lynerva",
      useSecureCookies: process.env.NODE_ENV === "production",
    },
    rateLimit: {
      enabled: true,
      window: 60,
      max: 30,
      customRules: {
        "/sign-in/email": { window: 60, max: 10 },
        "/sign-up/email": { window: 60, max: 5 },
        "/request-password-reset": { window: 300, max: 3 },
      },
    },
    plugins: [nextCookies()],
  });
}

type LynervaAuth = ReturnType<typeof createAuth>;

let cachedAuth: LynervaAuth | null = null;

export function getAuth(): LynervaAuth {
  if (!cachedAuth) cachedAuth = createAuth();
  return cachedAuth;
}

export type Session = LynervaAuth["$Infer"]["Session"];
