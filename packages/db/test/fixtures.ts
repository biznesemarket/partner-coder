import { randomUUID } from "node:crypto";

import type { Pool } from "pg";

export interface VendorBase {
  readonly vendorUserId: string;
  readonly planId: string;
}

export interface TenantFixture {
  readonly tenantId: string;
  readonly userId: string;
  readonly membershipId: string;
  readonly projectId: string;
  readonly policyId: string;
  readonly sessionId: string;
  readonly dayRecordId: string;
  readonly deviceId: string;
  readonly idempotencyKeyId: string;
}

export async function seedVendorBase(pool: Pool): Promise<VendorBase> {
  const vendorUserId = randomUUID();
  const planId = randomUUID();
  await pool.query(
    `insert into vendor_users (id, email, name, role, status)
     values ($1, 'vendor@example.com', 'Вендор', 'superadmin', 'active')`,
    [vendorUserId],
  );
  await pool.query(
    `insert into plans (id, code, name, price_kopecks, period, seats_limit, projects_limit)
     values ($1, 'demo', 'Демо', 100000, 'month', 10, 10)`,
    [planId],
  );
  return { vendorUserId, planId };
}

export async function seedTenant(
  pool: Pool,
  base: VendorBase,
  suffix: "a" | "b",
): Promise<TenantFixture> {
  const ids = {
    customer: randomUUID(),
    contract: randomUUID(),
    subscription: randomUUID(),
    invoice: randomUUID(),
    payment: randomUUID(),
    package: randomUUID(),
    onboarding: randomUUID(),
    tenant: randomUUID(),
    user: randomUUID(),
    authSession: randomUUID(),
    membership: randomUUID(),
    project: randomUUID(),
    policy: randomUUID(),
    rate: randomUUID(),
    valuation: randomUUID(),
    device: randomUUID(),
    session: randomUUID(),
    heartbeat: randomUUID(),
    interval: randomUUID(),
    dayRecord: randomUUID(),
    adjustment: randomUUID(),
    flag: randomUUID(),
    dispute: randomUUID(),
    payoutBatch: randomUUID(),
    payoutItem: randomUUID(),
    invitation: randomUUID(),
    integration: randomUUID(),
    connectorEvent: randomUUID(),
    repoFact: randomUUID(),
    notification: randomUUID(),
    digest: randomUUID(),
    snapshot: randomUUID(),
    audit: randomUUID(),
    idempotency: randomUUID(),
  };
  const start = `2026-11-0${suffix === "a" ? "1" : "2"}T09:00:00Z`;
  const end = `2026-11-0${suffix === "a" ? "1" : "2"}T09:01:00Z`;

  await pool.query(
    `insert into customers (id, legal_name, contact, status)
     values ($1, $2, '{}'::jsonb, 'active')`,
    [ids.customer, `ООО Демо ${suffix.toUpperCase()}`],
  );
  await pool.query(
    `insert into contracts (id, customer_id, plan_id, number, starts_on, status)
     values ($1, $2, $3, $4, '2026-11-01', 'active')`,
    [ids.contract, ids.customer, base.planId, `C-${suffix}`],
  );
  await pool.query(
    `insert into subscriptions (id, customer_id, contract_id, status, period_start, period_end, seats, projects_limit)
     values ($1, $2, $3, 'active', '2026-11-01', '2026-12-01', 3, 3)`,
    [ids.subscription, ids.customer, ids.contract],
  );
  await pool.query(
    `insert into invoices (id, customer_id, contract_id, number, issued_on, due_on, amount_kopecks, status)
     values ($1, $2, $3, $4, '2026-11-01', '2026-11-10', 100000, 'paid')`,
    [ids.invoice, ids.customer, ids.contract, `INV-${suffix}`],
  );
  await pool.query(
    `insert into payments (id, invoice_id, paid_on, amount_kopecks, method, recorded_by)
     values ($1, $2, '2026-11-05', 1000, 'bank_transfer', $3)`,
    [ids.payment, ids.invoice, base.vendorUserId],
  );
  await pool.query(
    `insert into provisioning_packages (id, customer_id, token_hash, token_prefix, version, status, expires_at, created_by)
     values ($1, $2, $3, $4, '0.1.0', 'issued', '2026-12-01T00:00:00Z', $5)`,
    [ids.package, ids.customer, `token-${suffix}`, `pc_${suffix}`, base.vendorUserId],
  );
  await pool.query(
    `insert into onboarding_sessions (id, customer_id, package_id, state, progress_bp)
     values ($1, $2, $3, 'active', 10000)`,
    [ids.onboarding, ids.customer, ids.package],
  );
  await pool.query(
    `insert into tenants (id, customer_id, name, slug, timezone, status)
     values ($1, $2, $3, $4, 'Europe/Moscow', 'active')`,
    [ids.tenant, ids.customer, `Tenant ${suffix.toUpperCase()}`, `tenant-${suffix}`],
  );
  await pool.query(
    `insert into users (id, email, name, status)
     values ($1, $2, $3, 'active')`,
    [ids.user, `user-${suffix}@example.com`, `Пользователь ${suffix.toUpperCase()}`],
  );
  await pool.query(
    `insert into auth_sessions (id, user_id, token_hash, expires_at)
     values ($1, $2, $3, '2026-12-01T00:00:00Z')`,
    [ids.authSession, ids.user, `session-${suffix}`],
  );
  await pool.query(
    `insert into memberships (id, tenant_id, user_id, role, status, display_name, joined_at)
     values ($1, $2, $3, 'director', 'active', $4, '2026-11-01T00:00:00Z')`,
    [ids.membership, ids.tenant, ids.user, `Директор ${suffix.toUpperCase()}`],
  );
  await pool.query(
    `insert into projects (id, tenant_id, name, forge, repo, timezone, status)
     values ($1, $2, $3, 'github', $4, 'Europe/Moscow', 'active')`,
    [ids.project, ids.tenant, `Проект ${suffix.toUpperCase()}`, `demo/${suffix}`],
  );
  await pool.query(
    `insert into project_members (tenant_id, project_id, membership_id, role)
     values ($1, $2, $3, 'director')`,
    [ids.tenant, ids.project, ids.membership],
  );
  await pool.query(
    `insert into policies (id, tenant_id, project_id, version, params, effective_from, approved_by, sha256)
     values ($1, $2, $3, 1, '{}'::jsonb, '2026-11-01T00:00:00Z', $4, $5)`,
    [ids.policy, ids.tenant, ids.project, ids.user, "a".repeat(64)],
  );
  await pool.query(
    `insert into rate_versions (id, tenant_id, policy_id, effective_from, value_kopecks, reason, approved_by)
     values ($1, $2, $3, '2026-11-01T00:00:00Z', 50000, 'Стартовая ставка', $4)`,
    [ids.rate, ids.tenant, ids.policy, ids.user],
  );
  await pool.query(
    `insert into valuation_versions (id, tenant_id, policy_id, effective_from, value_kopecks, reason, approved_by, adr_ref)
     values ($1, $2, $3, '2026-11-01T00:00:00Z', 100000000, 'Стартовая оценка', $4, 'ADR-0003')`,
    [ids.valuation, ids.tenant, ids.policy, ids.user],
  );
  await pool.query(
    `insert into devices (id, tenant_id, membership_id, public_key, name, os, status, last_seen)
     values ($1, $2, $3, $4, 'Ноутбук', 'Windows', 'active', '2026-11-01T00:00:00Z')`,
    [ids.device, ids.tenant, ids.membership, `key-${suffix}`],
  );
  await pool.query(
    `insert into work_sessions (id, tenant_id, project_id, membership_id, device_id, task_ref, branch, status, started_at)
     values ($1, $2, $3, $4, $5, 'TASK-1', 'main', 'ended', $6)`,
    [ids.session, ids.tenant, ids.project, ids.membership, ids.device, start],
  );
  await pool.query(
    `insert into heartbeats (event_id, tenant_id, session_id, seq, class, start_utc, end_utc, signals, signature_valid)
     values ($1, $2, $3, 0, 'active_human', $4, $5, '{"input_events": 1}'::jsonb, true)`,
    [ids.heartbeat, ids.tenant, ids.session, start, end],
  );
  await pool.query(
    `insert into intervals (id, tenant_id, session_id, class, start_utc, end_utc, seconds, source)
     values ($1, $2, $3, 'active_human', $4, $5, 60, 'agent')`,
    [ids.interval, ids.tenant, ids.session, start, end],
  );
  await pool.query(
    `insert into day_records
       (id, tenant_id, project_id, membership_id, date_local, timezone, paid_seconds, tracked_seconds,
        classes, amount_kopecks, cash_kopecks, equity_kopecks, share_bp, pool_used_bp, pool_pending,
        pending_equity_kopecks, versions, input_hash, explanation, closed_at)
     values ($1, $2, $3, $4, $5, 'Europe/Moscow', 60, 60,
             '{"activeSeconds": 60, "supervisedSeconds": 0, "autonomousSeconds": 0, "idleSeconds": 0}'::jsonb,
             100, 0, 100, 10, 0, false, 0,
             '{"policyVersionId": "p", "rateVersionIds": [], "valuationVersionId": "v"}'::jsonb,
             $6, '{}'::jsonb, '2026-11-02T00:00:00Z')`,
    [
      ids.dayRecord,
      ids.tenant,
      ids.project,
      ids.membership,
      suffix === "a" ? "2026-11-01" : "2026-11-02",
      "b".repeat(64),
    ],
  );
  await pool.query(
    `insert into day_adjustments (id, tenant_id, day_record_id, delta_kopecks, reason, source, input_hash, approved_by)
     values ($1, $2, $3, 0, 'Проверка корректировки', 'recalc', $4, $5)`,
    [ids.adjustment, ids.tenant, ids.dayRecord, "c".repeat(64), ids.user],
  );
  await pool.query(
    `insert into day_flags (id, tenant_id, day_record_id, code, detail)
     values ($1, $2, $3, 'cap_applied', 'Проверка флага')`,
    [ids.flag, ids.tenant, ids.dayRecord],
  );
  await pool.query(
    `insert into disputes (id, tenant_id, day_record_id, opened_by, reason, status, deadline)
     values ($1, $2, $3, $4, 'Проверка спора', 'open', '2026-11-20T00:00:00Z')`,
    [ids.dispute, ids.tenant, ids.dayRecord, ids.user],
  );
  await pool.query(
    `insert into payout_batches (id, tenant_id, period, status, created_by)
     values ($1, $2, '2026-11', 'draft', $3)`,
    [ids.payoutBatch, ids.tenant, ids.user],
  );
  await pool.query(
    `insert into payout_items (id, tenant_id, batch_id, membership_id, amount_kopecks, method)
     values ($1, $2, $3, $4, 100, 'bank_transfer')`,
    [ids.payoutItem, ids.tenant, ids.payoutBatch, ids.membership],
  );
  await pool.query(
    `insert into invitations (id, tenant_id, email, role, token_hash, status, invited_by, expires_at)
     values ($1, $2, $3, 'developer', $4, 'pending', $5, '2026-12-01T00:00:00Z')`,
    [
      ids.invitation,
      ids.tenant,
      `invite-${suffix}@example.com`,
      `invite-token-${suffix}`,
      ids.user,
    ],
  );
  await pool.query(
    `insert into git_integrations (id, tenant_id, project_id, provider, installation_id, repo, webhook_secret_hash, status)
     values ($1, $2, $3, 'github', $4, $5, $6, 'active')`,
    [ids.integration, ids.tenant, ids.project, `inst-${suffix}`, `demo/${suffix}`, `wh-${suffix}`],
  );
  await pool.query(
    `insert into connector_events (id, tenant_id, provider, delivery_id, event_type, project_id, payload_meta)
     values ($1, $2, 'github', $3, 'push', $4, '{}'::jsonb)`,
    [ids.connectorEvent, ids.tenant, `delivery-${suffix}`, ids.project],
  );
  await pool.query(
    `insert into repo_facts (id, tenant_id, project_id, kind, ref, task_ref, branch, occurred_at, payload_meta)
     values ($1, $2, $3, 'commit', $4, 'TASK-1', 'main', '2026-11-01T09:00:00Z', '{}'::jsonb)`,
    [ids.repoFact, ids.tenant, ids.project, `commit-${suffix}`],
  );
  await pool.query(
    `insert into notifications (id, tenant_id, recipient_user_id, recipient, channel, kind, status, payload)
     values ($1, $2, $3, $4, 'email', 'digest', 'pending', '{}'::jsonb)`,
    [ids.notification, ids.tenant, ids.user, `user-${suffix}@example.com`],
  );
  await pool.query(
    `insert into digest_runs (id, tenant_id, date_local, status)
     values ($1, $2, $3, 'pending')`,
    [ids.digest, ids.tenant, suffix === "a" ? "2026-11-01" : "2026-11-02"],
  );
  await pool.query(
    `insert into monthly_snapshots (id, tenant_id, month, sha256, payload)
     values ($1, $2, '2026-11-01', $3, '{}'::jsonb)`,
    [ids.snapshot, ids.tenant, "d".repeat(64)],
  );
  await pool.query(
    `insert into tenant_audit_events (id, tenant_id, actor, actor_type, action, entity, after)
     values ($1, $2, $3, 'user', 'test.action', 'test.entity', '{}'::jsonb)`,
    [ids.audit, ids.tenant, ids.user],
  );
  await pool.query(
    `insert into tenant_audit_anchors (tenant_id, date, last_hash, event_count)
     values ($1, '2026-11-14', $2, 1)`,
    [ids.tenant, "e".repeat(64)],
  );
  await pool.query(
    `insert into idempotency_keys (id, tenant_id, scope, key, request_hash, expires_at)
     values ($1, $2, 'POST /v1/tenant/test', $3, $4, '2026-12-01T00:00:00Z')`,
    [ids.idempotency, ids.tenant, `key-${suffix}`, "f".repeat(64)],
  );

  return {
    tenantId: ids.tenant,
    userId: ids.user,
    membershipId: ids.membership,
    projectId: ids.project,
    policyId: ids.policy,
    sessionId: ids.session,
    dayRecordId: ids.dayRecord,
    deviceId: ids.device,
    idempotencyKeyId: ids.idempotency,
  };
}
