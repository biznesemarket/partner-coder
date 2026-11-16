import { randomUUID } from "node:crypto";

import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { betterAuth } from "better-auth";

import {
  vendorAuthAccounts,
  vendorAuthRateLimits,
  vendorAuthSessions,
  vendorAuthVerifications,
  vendorUsers,
  type Database,
  type VendorUserStatus,
} from "@partner-coder/db";

import type { AuthMailer } from "../auth/mailer.js";

export interface CreateVendorAuthOptions {
  readonly db: Database;
  readonly secret: string;
  readonly baseURL: string;
  readonly vendorBaseURL: string;
  readonly sessionTtlHours: number;
  readonly passwordResetTtlMinutes: number;
  readonly passwordMinLength: number;
  readonly mailer: AuthMailer;
  /** Статус вендорского пользователя; неизвестный пользователь не получает письмо. */
  readonly getVendorStatus: (vendorUserId: string) => Promise<VendorUserStatus | null | undefined>;
  /** Активация и аудит после успешного сброса пароля. */
  readonly onPasswordReset: (vendorUserId: string) => Promise<void>;
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
 * Отдельный инстанс Better Auth вендорской консоли: email/password и сброс
 * пароля. TOTP и блокировка сессий suspended/disabled добавляются в Task 7.
 */
export function createVendorAuth(options: CreateVendorAuthOptions) {
  const vendorBaseURL = options.vendorBaseURL.replace(/\/+$/, "");

  return betterAuth({
    appName: "Партнер кодер — вендор",
    baseURL: options.baseURL,
    basePath: "/api/vendor-auth",
    secret: options.secret,
    trustedOrigins: [vendorBaseURL, options.baseURL],
    database: drizzleAdapter(options.db, {
      provider: "pg",
      schema: {
        user: vendorUsers,
        session: vendorAuthSessions,
        account: vendorAuthAccounts,
        verification: vendorAuthVerifications,
        ...(options.rateLimitStorage === "database" ? { rateLimit: vendorAuthRateLimits } : {}),
      },
    }),
    advanced: {
      database: {
        generateId: () => randomUUID(),
      },
      cookiePrefix: "pc-vendor",
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
        role: {
          type: "string",
          required: false,
          input: false,
        },
        status: {
          type: "string",
          required: false,
          defaultValue: "invited",
          input: false,
        },
      },
    },
    session: {
      expiresIn: options.sessionTtlHours * 60 * 60,
      updateAge: 15 * 60,
      additionalFields: {
        stepUpUntil: {
          type: "date",
          required: false,
          input: false,
        },
      },
    },
    emailAndPassword: {
      enabled: true,
      disableSignUp: false,
      autoSignIn: false,
      minPasswordLength: options.passwordMinLength,
      maxPasswordLength: 128,
      requireEmailVerification: false,
      resetPasswordTokenExpiresIn: options.passwordResetTtlMinutes * 60,
      revokeSessionsOnPasswordReset: true,
      async sendResetPassword({ user, token }) {
        const status = await options.getVendorStatus(user.id);
        if (status !== "invited" && status !== "active") {
          return;
        }
        const url = `${vendorBaseURL}/reset-password?token=${encodeURIComponent(token)}`;
        await options.mailer.sendVendorPasswordReset({ email: user.email, url });
      },
      async onPasswordReset({ user }) {
        await options.onPasswordReset(user.id);
      },
    },
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

export type VendorAuth = ReturnType<typeof createVendorAuth>;
