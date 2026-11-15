import { sql } from "drizzle-orm";
import {
  check,
  date,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { createdAt, intDefault, jsonObject, tenantId, updatedAt, uuidPk } from "./columns.js";
import {
  digestStatus,
  forge,
  integrationStatus,
  notificationChannel,
  notificationStatus,
  repoFactKind,
} from "./enums.js";
import { projects } from "./projects.js";
import { tenants, users } from "./identity.js";

export const gitIntegrations = pgTable(
  "git_integrations",
  {
    id: uuidPk(),
    tenantId: tenantId().references(() => tenants.id, { onDelete: "restrict" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "restrict" }),
    provider: forge("provider").notNull(),
    installationId: text("installation_id").notNull(),
    repo: text("repo").notNull(),
    webhookSecretHash: text("webhook_secret_hash").notNull(),
    status: integrationStatus("status").notNull().default("active"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("git_integrations_project_provider_uq").on(t.tenantId, t.projectId, t.provider),
    index("git_integrations_tenant_status_idx").on(t.tenantId, t.status),
  ],
);

export const connectorEvents = pgTable(
  "connector_events",
  {
    id: uuidPk(),
    tenantId: tenantId().references(() => tenants.id, { onDelete: "restrict" }),
    provider: forge("provider").notNull(),
    deliveryId: text("delivery_id").notNull(),
    eventType: text("event_type").notNull(),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "restrict" }),
    payloadMeta: jsonObject<Record<string, unknown>>("payload_meta"),
    receivedAt: timestamp("received_at", { withTimezone: true, precision: 3 })
      .notNull()
      .defaultNow(),
    processedAt: timestamp("processed_at", { withTimezone: true, precision: 3 }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("connector_events_delivery_uq").on(t.deliveryId),
    index("connector_events_tenant_received_idx").on(t.tenantId, t.receivedAt),
    index("connector_events_project_idx").on(t.projectId),
  ],
);

export const repoFacts = pgTable(
  "repo_facts",
  {
    id: uuidPk(),
    tenantId: tenantId().references(() => tenants.id, { onDelete: "restrict" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "restrict" }),
    kind: repoFactKind("kind").notNull(),
    ref: text("ref").notNull(),
    taskRef: text("task_ref"),
    branch: text("branch"),
    occurredAt: timestamp("occurred_at", { withTimezone: true, precision: 3 }).notNull(),
    payloadMeta: jsonObject<Record<string, unknown>>("payload_meta"),
    createdAt: createdAt(),
  },
  (t) => [
    index("repo_facts_project_branch_idx").on(t.projectId, t.branch),
    index("repo_facts_project_task_idx").on(t.projectId, t.taskRef),
    index("repo_facts_tenant_occurred_idx").on(t.tenantId, t.occurredAt),
    check("repo_facts_ref_len_chk", sql`length(${t.ref}) between 1 and 512`),
  ],
);

export const notifications = pgTable(
  "notifications",
  {
    id: uuidPk(),
    tenantId: tenantId().references(() => tenants.id, { onDelete: "restrict" }),
    recipientUserId: uuid("recipient_user_id").references(() => users.id, {
      onDelete: "restrict",
    }),
    recipient: text("recipient").notNull(),
    channel: notificationChannel("channel").notNull(),
    kind: text("kind").notNull(),
    status: notificationStatus("status").notNull().default("pending"),
    attempts: intDefault("attempts", 0),
    payload: jsonObject<Record<string, unknown>>("payload"),
    lastError: text("last_error"),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true, precision: 3 }),
    sentAt: timestamp("sent_at", { withTimezone: true, precision: 3 }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("notifications_status_next_idx").on(t.status, t.nextAttemptAt),
    index("notifications_tenant_created_idx").on(t.tenantId, t.createdAt),
    check("notifications_attempts_chk", sql`${t.attempts} >= 0`),
  ],
);

export const digestRuns = pgTable(
  "digest_runs",
  {
    id: uuidPk(),
    tenantId: tenantId().references(() => tenants.id, { onDelete: "restrict" }),
    dateLocal: date("date_local", { mode: "string" }).notNull(),
    status: digestStatus("status").notNull().default("pending"),
    rendered: jsonb("rendered"),
    sentAt: timestamp("sent_at", { withTimezone: true, precision: 3 }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("digest_runs_tenant_date_uq").on(t.tenantId, t.dateLocal)],
);
