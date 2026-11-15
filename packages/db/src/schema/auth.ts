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

import { createdAt, updatedAt } from "./columns.js";
import { users } from "./identity.js";

/**
 * Служебные таблицы Better Auth. Контур глобальный (не tenant): доступ есть
 * только у роли partner_coder_auth, API-роль их не видит.
 */

export const authAccounts = pgTable(
  "auth_accounts",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
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
    uniqueIndex("auth_accounts_provider_account_uq").on(t.providerId, t.accountId),
    index("auth_accounts_user_idx").on(t.userId),
  ],
);

export const authVerifications = pgTable(
  "auth_verifications",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true, precision: 3 }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("auth_verifications_identifier_idx").on(t.identifier),
    index("auth_verifications_expires_idx").on(t.expiresAt),
  ],
);

export const authTwoFactors = pgTable(
  "auth_two_factors",
  {
    id: text("id").primaryKey(),
    secret: text("secret").notNull(),
    backupCodes: text("backup_codes").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    verified: boolean("verified").notNull().default(true),
    failedVerificationCount: integer("failed_verification_count").notNull().default(0),
    lockedUntil: timestamp("locked_until", { withTimezone: true, precision: 3 }),
  },
  (t) => [
    index("auth_two_factors_user_idx").on(t.userId),
    index("auth_two_factors_secret_idx").on(t.secret),
    check("auth_two_factors_failed_chk", sql`${t.failedVerificationCount} >= 0`),
  ],
);

/**
 * Хранилище Better Auth rate limit (`rateLimit.storage = "database"`).
 * Таблица глобальная: ключ включает IP и путь, tenant_id не нужен. Better Auth
 * ожидает id-колонку в схеме, но id не читает; его генерирует БД, а
 * уникальность окна обеспечивает key.
 */
export const authRateLimits = pgTable(
  "auth_rate_limits",
  {
    id: text("id")
      .primaryKey()
      .default(sql`gen_random_uuid()::text`),
    key: text("key").notNull(),
    count: integer("count").notNull().default(0),
    lastRequest: bigint("last_request", { mode: "number" }).notNull(),
  },
  (t) => [
    uniqueIndex("auth_rate_limits_key_uq").on(t.key),
    index("auth_rate_limits_last_request_idx").on(t.lastRequest),
    check("auth_rate_limits_count_chk", sql`${t.count} >= 0`),
  ],
);

export const authPasskeys = pgTable(
  "auth_passkeys",
  {
    id: text("id").primaryKey(),
    name: text("name"),
    publicKey: text("public_key").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    credentialId: text("credential_id").notNull(),
    counter: integer("counter").notNull().default(0),
    deviceType: text("device_type").notNull(),
    backedUp: boolean("backed_up").notNull().default(false),
    transports: text("transports"),
    aaguid: text("aaguid"),
    createdAt: createdAt(),
  },
  (t) => [
    index("auth_passkeys_user_idx").on(t.userId),
    uniqueIndex("auth_passkeys_credential_uq").on(t.credentialId),
    check("auth_passkeys_counter_chk", sql`${t.counter} >= 0`),
  ],
);
