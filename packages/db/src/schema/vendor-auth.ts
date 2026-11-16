import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { createdAt, inetAddress, updatedAt, uuidPk } from "./columns.js";
import { vendorUsers } from "./vendor.js";

/**
 * Секреты второго инстанса Better Auth вендорской консоли. Контур глобальный:
 * таблицы доступны только роли partner_coder_vendor_auth, tenant-роли и
 * partner_coder_vendor их не видят.
 */

export const vendorAuthAccounts = pgTable(
  "vendor_auth_accounts",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => vendorUsers.id, { onDelete: "restrict" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", {
      withTimezone: true,
      precision: 3,
    }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", {
      withTimezone: true,
      precision: 3,
    }),
    scope: text("scope"),
    password: text("password"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("vendor_auth_accounts_provider_account_uq").on(t.providerId, t.accountId),
    index("vendor_auth_accounts_user_idx").on(t.userId),
  ],
);

export const vendorAuthSessions = pgTable(
  "vendor_auth_sessions",
  {
    id: uuidPk(),
    token: text("token").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => vendorUsers.id, { onDelete: "restrict" }),
    expiresAt: timestamp("expires_at", { withTimezone: true, precision: 3 }).notNull(),
    ipAddress: inetAddress("ip_address"),
    userAgent: text("user_agent"),
    stepUpUntil: timestamp("step_up_until", { withTimezone: true, precision: 3 }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("vendor_auth_sessions_token_uq").on(t.token),
    index("vendor_auth_sessions_user_idx").on(t.userId, t.expiresAt),
    index("vendor_auth_sessions_expires_idx").on(t.expiresAt),
  ],
);

export const vendorAuthVerifications = pgTable(
  "vendor_auth_verifications",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true, precision: 3 }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("vendor_auth_verifications_identifier_idx").on(t.identifier),
    index("vendor_auth_verifications_expires_idx").on(t.expiresAt),
  ],
);

export const vendorAuthTwoFactors = pgTable(
  "vendor_auth_two_factors",
  {
    id: text("id").primaryKey(),
    secret: text("secret").notNull(),
    backupCodes: text("backup_codes").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => vendorUsers.id, { onDelete: "restrict" }),
    verified: boolean("verified").notNull().default(true),
    failedVerificationCount: integer("failed_verification_count").notNull().default(0),
    lockedUntil: timestamp("locked_until", { withTimezone: true, precision: 3 }),
  },
  (t) => [
    index("vendor_auth_two_factors_user_idx").on(t.userId),
    check("vendor_auth_two_factors_failed_chk", sql`${t.failedVerificationCount} >= 0`),
  ],
);

export const vendorAuthPasskeys = pgTable(
  "vendor_auth_passkeys",
  {
    id: text("id").primaryKey(),
    name: text("name"),
    publicKey: text("public_key").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => vendorUsers.id, { onDelete: "restrict" }),
    /** Плагин passkey Better Auth ожидает свойство credentialID (именно ID). */
    credentialID: text("credential_id").notNull(),
    counter: integer("counter").notNull().default(0),
    deviceType: text("device_type").notNull(),
    backedUp: boolean("backed_up").notNull().default(false),
    transports: text("transports"),
    aaguid: text("aaguid"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("vendor_auth_passkeys_credential_uq").on(t.credentialID),
    index("vendor_auth_passkeys_user_idx").on(t.userId),
    check("vendor_auth_passkeys_counter_chk", sql`${t.counter} >= 0`),
  ],
);

export const vendorAuthRateLimits = pgTable(
  "vendor_auth_rate_limits",
  {
    id: text("id")
      .primaryKey()
      .default(sql`gen_random_uuid()::text`),
    key: text("key").notNull(),
    count: integer("count").notNull().default(0),
    lastRequest: bigint("last_request", { mode: "number" }).notNull(),
  },
  (t) => [
    uniqueIndex("vendor_auth_rate_limits_key_uq").on(t.key),
    index("vendor_auth_rate_limits_last_request_idx").on(t.lastRequest),
    check("vendor_auth_rate_limits_count_chk", sql`${t.count} >= 0`),
  ],
);

export const vendorAuthEmailLimits = pgTable(
  "vendor_auth_email_limits",
  {
    key: text("key").primaryKey(),
    count: integer("count").notNull().default(0),
    windowStartedAt: timestamp("window_started_at", {
      withTimezone: true,
      precision: 3,
    }).notNull(),
  },
  (t) => [
    index("vendor_auth_email_limits_window_idx").on(t.windowStartedAt),
    check("vendor_auth_email_limits_count_chk", sql`${t.count} >= 0`),
  ],
);
