import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { createdAt, uuidPk } from "./columns.js";
import { idempotencyStatus } from "./enums.js";
import { tenants } from "./identity.js";

export const idempotencyKeys = pgTable(
  "idempotency_keys",
  {
    id: uuidPk(),
    tenantId: uuid("tenant_id").references(() => tenants.id, { onDelete: "restrict" }),
    scope: text("scope").notNull(),
    key: text("key").notNull(),
    requestHash: text("request_hash").notNull(),
    status: idempotencyStatus("status").notNull().default("in_progress"),
    statusCode: integer("status_code"),
    response: jsonb("response"),
    createdAt: createdAt(),
    expiresAt: timestamp("expires_at", { withTimezone: true, precision: 3 }).notNull(),
  },
  (t) => [
    uniqueIndex("idempotency_keys_owner_scope_key_uq").on(
      sql`coalesce(${t.tenantId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
      t.scope,
      t.key,
    ),
    index("idempotency_keys_expires_idx").on(t.expiresAt),
    check("idempotency_keys_scope_len_chk", sql`length(${t.scope}) between 1 and 128`),
    check("idempotency_keys_key_len_chk", sql`length(${t.key}) between 1 and 255`),
    check("idempotency_keys_request_hash_chk", sql`length(${t.requestHash}) = 64`),
    check(
      "idempotency_keys_status_code_chk",
      sql`${t.statusCode} is null or (${t.statusCode} between 100 and 599)`,
    ),
  ],
);
