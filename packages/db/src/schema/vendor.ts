import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
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

import { createdAt, jsonObject, kopecks, updatedAt, uuidPk } from "./columns.js";
import {
  billingPeriod,
  contractStatus,
  customerStatus,
  invoiceStatus,
  onboardingState,
  paymentMethod,
  provisioningPackageStatus,
  subscriptionStatus,
  vendorRole,
  vendorUserStatus,
} from "./enums.js";

export interface VendorContact {
  readonly name?: string;
  readonly email?: string;
  readonly phone?: string;
  readonly address?: string;
}

export interface PlanFeatures {
  readonly [feature: string]: boolean | number | string;
}

export interface ContractLimits {
  readonly seats?: number;
  readonly projects?: number;
  readonly [limit: string]: number | undefined;
}

export const vendorUsers = pgTable(
  "vendor_users",
  {
    id: uuidPk(),
    email: text("email").notNull(),
    name: text("name").notNull(),
    emailVerified: boolean("email_verified").notNull().default(false),
    image: text("image"),
    role: vendorRole("role").notNull().default("support"),
    status: vendorUserStatus("status").notNull().default("invited"),
    twoFactorEnabled: boolean("mfa_enabled").notNull().default(false),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true, precision: 3 }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("vendor_users_email_lower_uq").on(sql`lower(${t.email})`),
    index("vendor_users_role_idx").on(t.role),
  ],
);

export const customers = pgTable(
  "customers",
  {
    id: uuidPk(),
    legalName: text("legal_name").notNull(),
    inn: text("inn"),
    kpp: text("kpp"),
    contact: jsonObject<VendorContact>("contact"),
    status: customerStatus("status").notNull().default("lead"),
    notes: text("notes"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("customers_inn_uq")
      .on(t.inn)
      .where(sql`${t.inn} is not null`),
    index("customers_status_idx").on(t.status),
    check("customers_inn_format_chk", sql`${t.inn} is null or ${t.inn} ~ '^[0-9]{10,12}$'`),
    check("customers_kpp_format_chk", sql`${t.kpp} is null or ${t.kpp} ~ '^[0-9]{9}$'`),
  ],
);

export const plans = pgTable(
  "plans",
  {
    id: uuidPk(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    priceKopecks: kopecks("price_kopecks"),
    period: billingPeriod("period").notNull().default("month"),
    seatsLimit: integer("seats_limit").notNull(),
    projectsLimit: integer("projects_limit").notNull(),
    features: jsonObject<PlanFeatures>("features"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("plans_code_uq").on(t.code),
    check("plans_price_chk", sql`${t.priceKopecks} >= 0`),
    check("plans_seats_chk", sql`${t.seatsLimit} >= 1`),
    check("plans_projects_chk", sql`${t.projectsLimit} >= 1`),
  ],
);

export const contracts = pgTable(
  "contracts",
  {
    id: uuidPk(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "restrict" }),
    planId: uuid("plan_id")
      .notNull()
      .references(() => plans.id, { onDelete: "restrict" }),
    number: text("number").notNull(),
    startsOn: date("starts_on", { mode: "string" }).notNull(),
    endsOn: date("ends_on", { mode: "string" }),
    limits: jsonObject<ContractLimits>("limits"),
    status: contractStatus("status").notNull().default("draft"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("contracts_number_uq").on(t.number),
    index("contracts_customer_idx").on(t.customerId),
    check("contracts_period_chk", sql`${t.endsOn} is null or ${t.endsOn} >= ${t.startsOn}`),
  ],
);

export const subscriptions = pgTable(
  "subscriptions",
  {
    id: uuidPk(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "restrict" }),
    contractId: uuid("contract_id")
      .notNull()
      .references(() => contracts.id, { onDelete: "restrict" }),
    status: subscriptionStatus("status").notNull().default("trial"),
    periodStart: date("period_start", { mode: "string" }).notNull(),
    periodEnd: date("period_end", { mode: "string" }).notNull(),
    graceUntil: timestamp("grace_until", { withTimezone: true, precision: 3 }),
    seats: integer("seats").notNull(),
    projectsLimit: integer("projects_limit").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("subscriptions_customer_idx").on(t.customerId),
    check("subscriptions_period_chk", sql`${t.periodEnd} >= ${t.periodStart}`),
    check("subscriptions_seats_chk", sql`${t.seats} >= 1`),
    check("subscriptions_projects_chk", sql`${t.projectsLimit} >= 1`),
  ],
);

export const invoices = pgTable(
  "invoices",
  {
    id: uuidPk(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "restrict" }),
    contractId: uuid("contract_id")
      .notNull()
      .references(() => contracts.id, { onDelete: "restrict" }),
    number: text("number").notNull(),
    issuedOn: date("issued_on", { mode: "string" }).notNull(),
    dueOn: date("due_on", { mode: "string" }).notNull(),
    amountKopecks: kopecks("amount_kopecks"),
    status: invoiceStatus("status").notNull().default("draft"),
    pdfUrl: text("pdf_url"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("invoices_number_uq").on(t.number),
    index("invoices_customer_status_idx").on(t.customerId, t.status),
    check("invoices_due_chk", sql`${t.dueOn} >= ${t.issuedOn}`),
    check("invoices_amount_chk", sql`${t.amountKopecks} >= 0`),
  ],
);

export const payments = pgTable(
  "payments",
  {
    id: uuidPk(),
    invoiceId: uuid("invoice_id")
      .notNull()
      .references(() => invoices.id, { onDelete: "restrict" }),
    paidOn: date("paid_on", { mode: "string" }).notNull(),
    amountKopecks: kopecks("amount_kopecks"),
    method: paymentMethod("method").notNull().default("bank_transfer"),
    reference: text("reference"),
    recordedBy: uuid("recorded_by")
      .notNull()
      .references(() => vendorUsers.id, { onDelete: "restrict" }),
    createdAt: createdAt(),
  },
  (t) => [
    index("payments_invoice_idx").on(t.invoiceId),
    check("payments_amount_chk", sql`${t.amountKopecks} > 0`),
  ],
);

export const provisioningPackages = pgTable(
  "provisioning_packages",
  {
    id: uuidPk(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "restrict" }),
    tokenHash: text("token_hash").notNull(),
    tokenPrefix: text("token_prefix").notNull(),
    version: text("version").notNull(),
    checksum: text("checksum"),
    status: provisioningPackageStatus("status").notNull().default("issued"),
    expiresAt: timestamp("expires_at", { withTimezone: true, precision: 3 }).notNull(),
    activatedAt: timestamp("activated_at", { withTimezone: true, precision: 3 }),
    activatedIp: inet("activated_ip"),
    createdBy: uuid("created_by").references(() => vendorUsers.id, { onDelete: "restrict" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("provisioning_packages_token_uq").on(t.tokenHash),
    index("provisioning_packages_customer_idx").on(t.customerId, t.status),
  ],
);

export const onboardingSessions = pgTable(
  "onboarding_sessions",
  {
    id: uuidPk(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "restrict" }),
    packageId: uuid("package_id")
      .notNull()
      .references(() => provisioningPackages.id, { onDelete: "restrict" }),
    state: onboardingState("state").notNull().default("issued"),
    answers: jsonObject<Record<string, unknown>>("answers"),
    progressBp: integer("progress_bp").notNull().default(0),
    blockedReason: text("blocked_reason"),
    lastActivityAt: timestamp("last_activity_at", { withTimezone: true, precision: 3 }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("onboarding_sessions_customer_idx").on(t.customerId, t.state),
    check("onboarding_sessions_progress_chk", sql`${t.progressBp} between 0 and 10000`),
  ],
);

export const vendorAuditEvents = pgTable(
  "vendor_audit_events",
  {
    id: uuidPk(),
    actorId: uuid("actor_id").references(() => vendorUsers.id, { onDelete: "restrict" }),
    customerId: uuid("customer_id").references(() => customers.id, { onDelete: "restrict" }),
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
    index("vendor_audit_events_created_idx").on(t.createdAt),
    uniqueIndex("vendor_audit_events_seq_uq").on(t.chainSeq),
    uniqueIndex("vendor_audit_events_hash_uq").on(t.hash),
    uniqueIndex("vendor_audit_events_prev_uq")
      .on(t.prevHash)
      .where(sql`${t.prevHash} is not null`),
    check("vendor_audit_events_hash_chk", sql`${t.hash} ~ '^[0-9a-f]{64}$'`),
    check(
      "vendor_audit_events_prev_hash_chk",
      sql`${t.prevHash} is null or ${t.prevHash} ~ '^[0-9a-f]{64}$'`,
    ),
    check("vendor_audit_events_seq_chk", sql`${t.chainSeq} >= 1`),
  ],
);

export const vendorAuditAnchors = pgTable(
  "vendor_audit_anchors",
  {
    date: date("date", { mode: "string" }).primaryKey(),
    lastHash: text("last_hash").notNull(),
    eventCount: integer("event_count").notNull(),
    anchoredAt: timestamp("anchored_at", { withTimezone: true, precision: 3 })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    check("vendor_audit_anchors_count_chk", sql`${t.eventCount} >= 0`),
    check("vendor_audit_anchors_hash_chk", sql`${t.lastHash} ~ '^[0-9a-f]{64}$'`),
  ],
);
