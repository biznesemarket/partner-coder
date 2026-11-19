import { randomUUID } from "node:crypto";

import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { passkey } from "@better-auth/passkey";
import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { twoFactor } from "better-auth/plugins";

import {
  vendorAuthAccounts,
  vendorAuthPasskeys,
  vendorAuthRateLimits,
  vendorAuthSessions,
  vendorAuthTwoFactors,
  vendorAuthVerifications,
  vendorUsers,
  type Database,
  type VendorUserStatus,
} from "@partner-coder/db";

import type { AuthMailer } from "../auth/mailer.js";
import { normalizeBaseUrl } from "./base-url.js";

export interface CreateVendorAuthOptions {
  readonly db: Database;
  readonly secret: string;
  readonly baseURL: string;
  readonly vendorBaseURL: string;
  readonly sessionTtlHours: number;
  readonly passwordResetTtlMinutes: number;
  readonly passwordMinLength: number;
  readonly mailer: AuthMailer;
  /** rpID для WebAuthn: хост вендорской консоли без схемы и порта. */
  readonly webauthnRpId: string;
  /** Статус вендорского пользователя; неизвестный пользователь не получает письмо. */
  readonly getVendorStatus: (vendorUserId: string) => Promise<VendorUserStatus | null | undefined>;
  /** Статус по email для блокировки входа suspended/disabled. */
  readonly getVendorStatusByEmail: (email: string) => Promise<VendorUserStatus | null | undefined>;
  /** Отметка входа, аудит и активация приглашённого после создания сессии. */
  readonly onSessionCreated: (vendorUserId: string, ip: string | null) => Promise<void>;
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
 * Отдельный инстанс Better Auth вендорской консоли: email/password, сброс
 * пароля, TOTP и блокировка сессий suspended/disabled.
 */
export function createVendorAuth(options: CreateVendorAuthOptions) {
  const vendorBaseURL = normalizeBaseUrl(options.vendorBaseURL);

  return betterAuth({
    appName: "Партнёр кодер — вендор",
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
        twoFactor: vendorAuthTwoFactors,
        passkey: vendorAuthPasskeys,
        ...(options.rateLimitStorage === "database" ? { rateLimit: vendorAuthRateLimits } : {}),
      },
    }),
    plugins: [
      twoFactor({
        issuer: "Партнёр кодер (вендор)",
        backupCodeOptions: { amount: 10, storeBackupCodes: "encrypted" },
        accountLockout: { maxFailedAttempts: 5 },
      }),
      passkey({
        rpID: options.webauthnRpId,
        rpName: "Партнёр кодер (вендор)",
        origin: [vendorBaseURL],
        authenticatorSelection: { userVerification: "required", residentKey: "required" },
        advanced: { webAuthnChallengeCookie: "pc-vendor-passkey" },
      }),
    ],
    databaseHooks: {
      session: {
        create: {
          async before(session) {
            const status = await options.getVendorStatus(session.userId);
            if (status === "suspended" || status === "disabled") {
              return false;
            }
            return;
          },
          async after(session) {
            const rawIp = (session as { ipAddress?: unknown }).ipAddress;
            const ip = typeof rawIp === "string" && rawIp.length > 0 ? rawIp : null;
            try {
              await options.onSessionCreated(session.userId, ip);
            } catch {
              return;
            }
          },
        },
      },
    },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== "/sign-in/email") {
          return;
        }
        const body = ctx.body as { email?: unknown } | undefined;
        if (typeof body?.email !== "string") {
          return;
        }
        const status = await options.getVendorStatusByEmail(body.email);
        if (status === "suspended" || status === "disabled") {
          throw new APIError("FORBIDDEN", {
            message: "Вендорская учётная запись заблокирована",
            code: "VENDOR_INACTIVE",
          });
        }
      }),
    },
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
        await options.mailer.sendVendorPasswordReset({
          email: user.email,
          url,
          ttlMinutes: options.passwordResetTtlMinutes,
        });
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
