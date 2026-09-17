import "server-only";

import { betterAuth } from "better-auth/minimal";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { Resend } from "resend";
import { getDb } from "@/db";
import * as schema from "@/db/schema";

const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null;

export const auth = betterAuth({
  appName: "Lynerva",
  baseURL: process.env.BETTER_AUTH_URL,
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
    database: { joins: true },
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

export type Session = typeof auth.$Infer.Session;
