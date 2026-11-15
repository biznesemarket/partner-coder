import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  inet,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { createdAt, jsonObject, tenantId, updatedAt, uuidPk } from "./columns.js";
import {
  deviceStatus,
  invitationStatus,
  membershipRole,
  membershipStatus,
  tenantStatus,
  userStatus,
} from "./enums.js";
import { customers } from "./vendor.js";

export const users = pgTable(
  "users",
  {
    id: uuidPk(),
    email: text("email").notNull(),
    name: text("name").notNull(),
    authProvider: text("auth_provider").notNull().default("magic_link"),
    status: userStatus("status").notNull().default("invited"),
    locale: text("locale").notNull().default("ru-RU"),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true, precision: 3 }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("users_email_lower_uq").on(sql`lower(${t.email})`),
    index("users_status_idx").on(t.status),
  ],
);

export const authSessions = pgTable(
  "auth_sessions",
  {
    id: uuidPk(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true, precision: 3 }).notNull(),
    ip: inet("ip"),
    userAgent: text("user_agent"),
    revokedAt: timestamp("revoked_at", { withTimezone: true, precision: 3 }),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true, precision: 3 }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("auth_sessions_token_uq").on(t.tokenHash),
    index("auth_sessions_user_idx").on(t.userId, t.expiresAt),
  ],
);

export const tenants = pgTable(
  "tenants",
  {
    id: uuidPk(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    timezone: text("timezone").notNull().default("Europe/Moscow"),
    status: tenantStatus("status").notNull().default("onboarding"),
    settings: jsonObject<Record<string, unknown>>("settings"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("tenants_slug_uq").on(t.slug),
    index("tenants_customer_idx").on(t.customerId),
    check("tenants_slug_format_chk", sql`${t.slug} ~ '^[a-z0-9][a-z0-9-]{1,62}$'`),
    check("tenants_timezone_len_chk", sql`length(${t.timezone}) between 1 and 64`),
  ],
);

export const memberships = pgTable(
  "memberships",
  {
    id: uuidPk(),
    tenantId: tenantId().references(() => tenants.id, { onDelete: "restrict" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    role: membershipRole("role").notNull().default("developer"),
    status: membershipStatus("status").notNull().default("invited"),
    displayName: text("display_name"),
    joinedAt: timestamp("joined_at", { withTimezone: true, precision: 3 }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("memberships_tenant_user_uq").on(t.tenantId, t.userId),
    unique("memberships_tenant_id_uq").on(t.tenantId, t.id),
    index("memberships_tenant_role_idx").on(t.tenantId, t.role),
    index("memberships_user_idx").on(t.userId),
  ],
);

export const devices = pgTable(
  "devices",
  {
    id: uuidPk(),
    tenantId: tenantId().references(() => tenants.id, { onDelete: "restrict" }),
    membershipId: uuid("membership_id").notNull(),
    publicKey: text("public_key").notNull(),
    name: text("name").notNull(),
    os: text("os").notNull(),
    status: deviceStatus("status").notNull().default("pending"),
    lastSeen: timestamp("last_seen", { withTimezone: true, precision: 3 }),
    revokedAt: timestamp("revoked_at", { withTimezone: true, precision: 3 }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("devices_public_key_uq").on(t.publicKey),
    unique("devices_tenant_id_uq").on(t.tenantId, t.id),
    index("devices_membership_idx").on(t.membershipId, t.status),
    index("devices_tenant_idx").on(t.tenantId),
    foreignKey({
      name: "devices_membership_tenant_fk",
      columns: [t.tenantId, t.membershipId],
      foreignColumns: [memberships.tenantId, memberships.id],
    }).onDelete("restrict"),
  ],
);

export const invitations = pgTable(
  "invitations",
  {
    id: uuidPk(),
    tenantId: tenantId().references(() => tenants.id, { onDelete: "restrict" }),
    email: text("email").notNull(),
    role: membershipRole("role").notNull().default("developer"),
    tokenHash: text("token_hash").notNull(),
    status: invitationStatus("status").notNull().default("pending"),
    invitedBy: uuid("invited_by").references(() => users.id, { onDelete: "restrict" }),
    expiresAt: timestamp("expires_at", { withTimezone: true, precision: 3 }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true, precision: 3 }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("invitations_token_uq").on(t.tokenHash),
    index("invitations_tenant_email_idx").on(t.tenantId, sql`lower(${t.email})`),
    check("invitations_email_chk", sql`${t.email} ~ '^[^@[:space:]]+@[^@[:space:]]+$'`),
  ],
);
