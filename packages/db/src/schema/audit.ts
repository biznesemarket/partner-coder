import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  date,
  index,
  inet,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { createdAt, tenantId, uuidPk } from "./columns.js";
import { auditActorType } from "./enums.js";
import { tenants, users } from "./identity.js";

export const tenantAuditEvents = pgTable(
  "tenant_audit_events",
  {
    id: uuidPk(),
    tenantId: tenantId().references(() => tenants.id, { onDelete: "restrict" }),
    actor: uuid("actor").references(() => users.id, { onDelete: "restrict" }),
    actorType: auditActorType("actor_type").notNull().default("user"),
    action: text("action").notNull(),
    entity: text("entity").notNull(),
    before: jsonb("before"),
    after: jsonb("after"),
    ip: inet("ip"),
    prevHash: text("prev_hash"),
    hash: text("hash").notNull(),
    chainSeq: bigint("chain_seq", { mode: "bigint" }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index("tenant_audit_events_tenant_created_idx").on(t.tenantId, t.createdAt),
    uniqueIndex("tenant_audit_events_tenant_seq_uq").on(t.tenantId, t.chainSeq),
    uniqueIndex("tenant_audit_events_tenant_hash_uq").on(t.tenantId, t.hash),
    uniqueIndex("tenant_audit_events_tenant_prev_uq")
      .on(t.tenantId, t.prevHash)
      .where(sql`${t.prevHash} is not null`),
    check("tenant_audit_events_action_len_chk", sql`length(${t.action}) between 1 and 128`),
    check("tenant_audit_events_entity_len_chk", sql`length(${t.entity}) between 1 and 128`),
    check("tenant_audit_events_hash_chk", sql`${t.hash} ~ '^[0-9a-f]{64}$'`),
    check(
      "tenant_audit_events_prev_hash_chk",
      sql`${t.prevHash} is null or ${t.prevHash} ~ '^[0-9a-f]{64}$'`,
    ),
    check("tenant_audit_events_seq_chk", sql`${t.chainSeq} >= 1`),
  ],
);

export const tenantAuditAnchors = pgTable(
  "tenant_audit_anchors",
  {
    tenantId: tenantId().references(() => tenants.id, { onDelete: "restrict" }),
    date: date("date", { mode: "string" }).notNull(),
    lastHash: text("last_hash").notNull(),
    eventCount: integer("event_count").notNull(),
    anchoredAt: timestamp("anchored_at", { withTimezone: true, precision: 3 })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("tenant_audit_anchors_tenant_date_uq").on(t.tenantId, t.date),
    check("tenant_audit_anchors_count_chk", sql`${t.eventCount} >= 0`),
    check("tenant_audit_anchors_hash_chk", sql`${t.lastHash} ~ '^[0-9a-f]{64}$'`),
  ],
);
