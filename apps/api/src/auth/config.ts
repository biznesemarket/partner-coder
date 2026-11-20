import { createHmac, randomUUID } from "node:crypto";

import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { betterAuth } from "better-auth";
import { emailOTP, magicLink } from "better-auth/plugins";

import {
  authAccounts,
  authRateLimits,
  authSessions,
  authVerifications,
  users,
  type Database,
} from "@partner-coder/db";

import type { AuthMailer } from "./mailer.js";

export interface CreateAuthOptions {
  readonly db: Database;
  readonly secret: string;
  readonly baseURL: string;
  readonly webBaseURL: string;
  readonly sessionTtlHours: number;
  readonly magicLinkTtlMinutes: number;
  readonly mailer: AuthMailer;
  /** В тестах можно отключить rate limit. */
  readonly rateLimitEnabled?: boolean;
  /** `database` включает общий для инстансов store Better Auth. */
  readonly rateLimitStorage?: "memory" | "database";
  readonly rateLimitMax?: number;
  readonly rateLimitWindowSeconds?: number;
  readonly ipAddressHeaders?: readonly string[];
  readonly trustedProxies?: readonly string[];
}

/**
 * Better Auth с собственной схемой. Пользователи и сессии живут в users/
 * auth_sessions (snake_case), служебные таблицы — auth_accounts,
 * auth_verifications. OTP и magic-link токены хранятся только хешами.
 */
export function createAuth(options: CreateAuthOptions) {
  return betterAuth({
    appName: "Партнёр кодер",
    baseURL: options.baseURL,
    basePath: "/api/auth",
    secret: options.secret,
    trustedOrigins: [options.webBaseURL, options.baseURL],
    database: drizzleAdapter(options.db, {
      provider: "pg",
      schema: {
        user: users,
        session: authSessions,
        account: authAccounts,
        verification: authVerifications,
        ...(options.rateLimitStorage === "database" ? { rateLimit: authRateLimits } : {}),
      },
    }),
    advanced: {
      database: {
        generateId: () => randomUUID(),
      },
      ...((options.ipAddressHeaders?.length ?? 0) > 0 || (options.trustedProxies?.length ?? 0) > 0
        ? {
            ipAddress: {
              ...(options.ipAddressHeaders && options.ipAddressHeaders.length > 0
                ? { ipAddressHeaders: [...options.ipAddressHeaders] }
                : {}),
              ...(options.trustedProxies && options.trustedProxies.length > 0
                ? { trustedProxies: [...options.trustedProxies] }
                : {}),
            },
          }
        : {}),
    },
    user: {
      additionalFields: {
        status: {
          type: "string",
          required: false,
          defaultValue: "active",
          input: false,
        },
        locale: {
          type: "string",
          required: false,
          defaultValue: "ru-RU",
          input: false,
        },
      },
    },
    session: {
      expiresIn: options.sessionTtlHours * 60 * 60,
      updateAge: 60 * 60,
      additionalFields: {
        activeTenantId: {
          type: "string",
          required: false,
          input: false,
        },
      },
    },
    account: {},
    verification: {},
    emailAndPassword: {
      enabled: false,
    },
    plugins: [
      emailOTP({
        otpLength: 6,
        expiresIn: 10 * 60,
        storeOTP: {
          hash: async (otp) => createHmac("sha256", options.secret).update(otp).digest("hex"),
        },
        async sendVerificationOTP({ email, otp, type }) {
          await options.mailer.sendOtp({ email, otp, type });
        },
      }),
      magicLink({
        expiresIn: options.magicLinkTtlMinutes * 60,
        storeToken: "hashed",
        async sendMagicLink({ email, url, token }) {
          await options.mailer.sendMagicLink({ email, url, token });
        },
      }),
    ],
    rateLimit: {
      enabled: options.rateLimitEnabled ?? true,
      window: options.rateLimitWindowSeconds ?? 60,
      max: options.rateLimitMax ?? 20,
      ...(options.rateLimitStorage === "database"
        ? { storage: "database" as const, modelName: "rateLimit" }
        : {}),
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
