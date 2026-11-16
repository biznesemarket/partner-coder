import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createTestDatabase, type TestDatabase } from "./helpers.js";

const expectedTables = [
  "auth_accounts",
  "auth_passkeys",
  "auth_rate_limits",
  "auth_sessions",
  "auth_two_factors",
  "auth_verifications",
  "connector_events",
  "contracts",
  "customers",
  "day_adjustments",
  "day_flags",
  "day_records",
  "device_tokens",
  "devices",
  "digest_runs",
  "disputes",
  "email_rate_limits",
  "git_integrations",
  "heartbeats",
  "idempotency_keys",
  "intervals",
  "invitations",
  "invoices",
  "memberships",
  "monthly_snapshots",
  "notifications",
  "onboarding_sessions",
  "payments",
  "payout_batches",
  "payout_items",
  "plans",
  "policies",
  "project_members",
  "projects",
  "provisioning_packages",
  "rate_versions",
  "repo_facts",
  "subscriptions",
  "tenant_audit_anchors",
  "tenant_audit_events",
  "tenants",
  "users",
  "valuation_versions",
  "vendor_audit_anchors",
  "vendor_audit_events",
  "vendor_auth_accounts",
  "vendor_auth_email_limits",
  "vendor_auth_passkeys",
  "vendor_auth_rate_limits",
  "vendor_auth_sessions",
  "vendor_auth_two_factors",
  "vendor_auth_verifications",
  "vendor_users",
  "work_sessions",
] as const;

const tenantScopedTables = [
  "memberships",
  "projects",
  "project_members",
  "policies",
  "rate_versions",
  "valuation_versions",
  "work_sessions",
  "heartbeats",
  "intervals",
  "day_records",
  "day_adjustments",
  "day_flags",
  "disputes",
  "payout_batches",
  "payout_items",
  "device_tokens",
  "devices",
  "invitations",
  "git_integrations",
  "connector_events",
  "repo_facts",
  "notifications",
  "digest_runs",
  "monthly_snapshots",
  "tenant_audit_events",
  "tenant_audit_anchors",
] as const;

describe("схема БД", () => {
  let database: TestDatabase;

  beforeAll(async () => {
    database = await createTestDatabase();
  }, 120_000);

  afterAll(async () => {
    await database?.drop();
  }, 60_000);

  it("создает все таблицы из мега-плана §6", async () => {
    const { rows } = await database.pool.query<{ tablename: string }>(
      "select tablename from pg_tables where schemaname = 'public' order by tablename",
    );
    expect(rows.map((row) => row.tablename)).toEqual([...expectedTables]);
  });

  it("включает tenant_id NOT NULL во всех тенантских таблицах", async () => {
    const { rows } = await database.pool.query<{ table_name: string; is_nullable: string }>(
      `select table_name, is_nullable
         from information_schema.columns
        where table_schema = 'public' and column_name = 'tenant_id'
        order by table_name`,
    );
    const present = new Map(rows.map((row) => [row.table_name, row.is_nullable]));
    for (const table of tenantScopedTables) {
      expect(present.get(table), `${table}.tenant_id отсутствует`).toBe("NO");
    }
    expect(present.get("idempotency_keys")).toBe("YES");
  });

  it("создает уникальные ограничения из §6.3", async () => {
    const { rows } = await database.pool.query<{ indexname: string }>(
      "select indexname from pg_indexes where schemaname = 'public'",
    );
    const indexes = new Set(rows.map((row) => row.indexname));
    for (const index of [
      "heartbeats_session_seq_uq",
      "day_records_tenant_project_member_date_uq",
      "connector_events_provider_delivery_uq",
      "invoices_number_uq",
      "memberships_tenant_user_uq",
      "projects_tenant_forge_repo_uq",
      "idempotency_keys_owner_scope_key_uq",
    ]) {
      expect(indexes.has(index), `${index} отсутствует`).toBe(true);
    }
  });

  it("ставит RESTRICT на удаление закрытых записей", async () => {
    const { rows } = await database.pool.query<{
      table_name: string;
      confdeltype: string;
    }>(
      `select c.conrelid::regclass::text as table_name, c.confdeltype
         from pg_constraint c
        where c.contype = 'f'
          and c.confrelid = 'day_records'::regclass`,
    );
    expect(rows.length).toBeGreaterThanOrEqual(3);
    for (const row of rows) {
      expect(row.confdeltype, `${row.table_name} должен быть RESTRICT`).toBe("r");
    }
  });

  it("создает enum-типы и check-ограничения домена", async () => {
    const { rows: enums } = await database.pool.query<{ typname: string }>(
      "select typname from pg_type where typtype = 'e'",
    );
    const enumNames = new Set(enums.map((row) => row.typname));
    for (const name of [
      "interval_class",
      "interval_source",
      "membership_role",
      "forge",
      "audit_actor_type",
    ]) {
      expect(enumNames.has(name), `${name} отсутствует`).toBe(true);
    }

    const { rows: checks } = await database.pool.query<{ conname: string }>(
      "select conname from pg_constraint where contype = 'c'",
    );
    const checkNames = new Set(checks.map((row) => row.conname));
    for (const name of [
      "day_records_input_hash_chk",
      "day_records_split_chk",
      "heartbeats_period_chk",
      "payout_batches_period_chk",
    ]) {
      expect(checkNames.has(name), `${name} отсутствует`).toBe(true);
    }
  });
});
