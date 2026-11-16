import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDatabase, type Database } from "@partner-coder/db";

import { createTestDatabase, type TestDatabase } from "../../../../packages/db/test/helpers.js";
import {
  seedTenant,
  seedVendorBase,
  type TenantFixture,
} from "../../../../packages/db/test/fixtures.js";
import { runTtlCleanup } from "./ttl-cleanup.js";

describe("TTL-очистка и отзыв при suspension", () => {
  let testDb: TestDatabase;
  let db: Database;
  let tenantA: TenantFixture;
  let tenantB: TenantFixture;
  let vendorUserId: string;
  let expiredVerification: string;
  let expiredIdempotency: string;
  let expiredSession: string;
  let expiredDeviceToken: string;
  let suspendedTenantSession: string;
  let suspendedTenantDevice: string;
  let suspendedUserSession: string;
  let oldHeartbeat: string;

  beforeAll(async () => {
    testDb = await createTestDatabase();
    db = createDatabase(testDb.pool);
    const vendor = await seedVendorBase(testDb.pool);
    vendorUserId = vendor.vendorUserId;
    tenantA = await seedTenant(testDb.pool, vendor, "a");
    tenantB = await seedTenant(testDb.pool, vendor, "b");

    expiredVerification = randomUUID();
    expiredIdempotency = randomUUID();
    expiredSession = randomUUID();
    expiredDeviceToken = randomUUID();
    suspendedTenantSession = randomUUID();
    suspendedTenantDevice = randomUUID();
    suspendedUserSession = randomUUID();
    oldHeartbeat = randomUUID();

    await testDb.pool.query(
      `insert into auth_verifications (id, identifier, value, expires_at)
       values ($1, 'otp:expired@example.com', 'hash', now() - interval '5 days')`,
      [expiredVerification],
    );
    await testDb.pool.query(
      `insert into idempotency_keys (id, tenant_id, scope, key, request_hash, expires_at)
       values ($1, $2, 'test', 'expired-key', $3, now() - interval '1 day')`,
      [expiredIdempotency, tenantA.tenantId, "a".repeat(64)],
    );
    await testDb.pool.query(
      `insert into auth_sessions (id, user_id, token, expires_at)
       values ($1, $2, $3, now() - interval '10 days')`,
      [expiredSession, tenantA.userId, `expired-${expiredSession}`],
    );
    await testDb.pool.query(
      `insert into auth_rate_limits (key, count, last_request)
       values ('old-ip', 1, $1), ('fresh-ip', 1, $2)`,
      [Date.now() - 2 * 86_400_000, Date.now()],
    );
    await testDb.pool.query(
      `insert into email_rate_limits (key, count, window_started_at)
       values ('old@example.com', 1, now() - interval '2 days'),
              ('fresh@example.com', 1, now())`,
    );
    await testDb.pool.query(
      `insert into device_tokens
         (id, tenant_id, membership_id, token_hash, token_prefix, expires_at)
       values ($1, $2, $3, $4, 'pcd_tst', now() - interval '1 day')`,
      [
        expiredDeviceToken,
        tenantA.tenantId,
        tenantA.membershipId,
        randomUUID().replaceAll("-", "").padEnd(64, "0"),
      ],
    );
    await testDb.pool.query(
      `insert into heartbeats
         (event_id, tenant_id, session_id, seq, class, start_utc, end_utc, received_at)
       values ($1, $2, $3, 20, 'active_human',
               now() - interval '100 days', now() - interval '100 days' + interval '1 minute',
               now() - interval '100 days')`,
      [oldHeartbeat, tenantA.tenantId, tenantA.sessionId],
    );

    await testDb.pool.query("update tenants set status = 'suspended' where id = $1", [
      tenantB.tenantId,
    ]);
    await testDb.pool.query(
      `insert into auth_sessions (id, user_id, token, active_tenant_id, expires_at)
       values ($1, $2, $3, $4, now() + interval '1 day')`,
      [
        suspendedTenantSession,
        tenantB.userId,
        `suspended-${suspendedTenantSession}`,
        tenantB.tenantId,
      ],
    );
    await testDb.pool.query(
      `insert into device_tokens
         (id, tenant_id, membership_id, token_hash, token_prefix)
       values ($1, $2, $3, $4, 'pcd_tst')`,
      [
        suspendedTenantDevice,
        tenantB.tenantId,
        tenantB.membershipId,
        randomUUID().replaceAll("-", "").padEnd(64, "1"),
      ],
    );

    await testDb.pool.query(
      `insert into users (id, email, name, status)
       values ($1, $2, 'Заблокирован', 'suspended')`,
      [randomUUID(), `suspended-user-${randomUUID()}@example.com`],
    );
    const suspendedUser = await testDb.pool.query<{ id: string }>(
      "select id from users where status = 'suspended' and name = 'Заблокирован' limit 1",
    );
    await testDb.pool.query(
      `insert into auth_sessions (id, user_id, token, expires_at)
       values ($1, $2, $3, now() + interval '1 day')`,
      [suspendedUserSession, suspendedUser.rows[0]!.id, `suspended-user-${suspendedUserSession}`],
    );
  });

  afterAll(async () => {
    await testDb?.drop();
  });

  it("удаляет просроченные записи, отзывает токены и чистит heartbeat", async () => {
    const result = await runTtlCleanup(db, {
      sessionRetentionDays: 7,
      verificationRetentionDays: 1,
      heartbeatRetentionDays: 90,
    });

    expect(result).toMatchObject({
      idempotencyKeys: 1,
      authVerifications: 1,
      authRateLimits: 1,
      emailRateLimits: 1,
      authSessionsExpired: 1,
    });

    const verification = await testDb.pool.query("select 1 from auth_verifications where id = $1", [
      expiredVerification,
    ]);
    expect(verification.rowCount).toBe(0);

    const idempotency = await testDb.pool.query("select 1 from idempotency_keys where id = $1", [
      expiredIdempotency,
    ]);
    expect(idempotency.rowCount).toBe(0);

    const session = await testDb.pool.query("select 1 from auth_sessions where id = $1", [
      expiredSession,
    ]);
    expect(session.rowCount).toBe(0);

    const authRateLimits = await testDb.pool.query<{ key: string }>(
      "select key from auth_rate_limits order by key",
    );
    expect(authRateLimits.rows.map((row) => row.key)).toEqual(["fresh-ip"]);

    const emailRateLimits = await testDb.pool.query<{ key: string }>(
      "select key from email_rate_limits order by key",
    );
    expect(emailRateLimits.rows.map((row) => row.key)).toEqual(["fresh@example.com"]);

    const device = await testDb.pool.query<{ revoked_at: string | null }>(
      "select revoked_at from device_tokens where id = $1",
      [expiredDeviceToken],
    );
    expect(device.rows[0]?.revoked_at).not.toBeNull();

    const heartbeat = await testDb.pool.query("select 1 from heartbeats where event_id = $1", [
      oldHeartbeat,
    ]);
    expect(heartbeat.rowCount).toBe(0);
  });

  it("при suspension tenant очищает активный tenant и отзывает его device-токены", async () => {
    const tenantSession = await testDb.pool.query<{ active_tenant_id: string | null }>(
      "select active_tenant_id from auth_sessions where id = $1",
      [suspendedTenantSession],
    );
    expect(tenantSession.rows[0]?.active_tenant_id).toBeNull();

    const device = await testDb.pool.query<{ revoked_at: string | null }>(
      "select revoked_at from device_tokens where id = $1",
      [suspendedTenantDevice],
    );
    expect(device.rows[0]?.revoked_at).not.toBeNull();
  });

  it("удаляет сессии suspended/deleted пользователей", async () => {
    const session = await testDb.pool.query("select 1 from auth_sessions where id = $1", [
      suspendedUserSession,
    ]);
    expect(session.rowCount).toBe(0);
  });

  it("чистит просроченные vendor-auth сессии, проверки и окна", async () => {
    const expiredVendorSession = randomUUID();
    const freshVendorSession = randomUUID();
    const expiredVendorVerification = `vendor-expired-${randomUUID()}`;
    const freshVendorVerification = `vendor-fresh-${randomUUID()}`;
    const twoFactorId = randomUUID();
    const passkeyId = randomUUID();

    await testDb.pool.query(
      `insert into vendor_auth_sessions (id, token, user_id, expires_at)
       values ($1, $2, $3, now() - interval '30 days'),
              ($4, $5, $3, now() + interval '1 day')`,
      [
        expiredVendorSession,
        `expired-${expiredVendorSession}`,
        vendorUserId,
        freshVendorSession,
        `fresh-${freshVendorSession}`,
      ],
    );
    await testDb.pool.query(
      `insert into vendor_auth_verifications (id, identifier, value, expires_at)
       values ($1, 'otp:vendor-expired@example.com', 'hash', now() - interval '5 days'),
              ($2, 'otp:vendor-fresh@example.com', 'hash', now() + interval '1 day')`,
      [expiredVendorVerification, freshVendorVerification],
    );
    await testDb.pool.query(
      `insert into vendor_auth_rate_limits (key, count, last_request)
       values ('vendor-old-ip', 1, $1), ('vendor-fresh-ip', 1, $2)`,
      [Date.now() - 2 * 86_400_000, Date.now()],
    );
    await testDb.pool.query(
      `insert into vendor_auth_email_limits (key, count, window_started_at)
       values ('vendor-old@example.com', 1, now() - interval '2 days'),
              ('vendor-fresh@example.com', 1, now())`,
    );
    await testDb.pool.query(
      `insert into vendor_auth_two_factors (id, secret, backup_codes, user_id)
       values ($1, 'secret', 'codes', $2)`,
      [twoFactorId, vendorUserId],
    );
    await testDb.pool.query(
      `insert into vendor_auth_passkeys (id, public_key, user_id, credential_id, device_type)
       values ($1, 'public-key', $2, $3, 'singleDevice')`,
      [passkeyId, vendorUserId, `credential-${passkeyId}`],
    );

    const result = await runTtlCleanup(db, {
      sessionRetentionDays: 7,
      verificationRetentionDays: 1,
      heartbeatRetentionDays: 90,
    });

    expect(result.vendorAuthSessions).toBe(1);
    expect(result.vendorAuthVerifications).toBe(1);
    expect(result.vendorAuthRateLimits).toBe(1);
    expect(result.vendorAuthEmailLimits).toBe(1);

    const sessions = await testDb.pool.query<{ id: string }>(
      "select id from vendor_auth_sessions order by id",
    );
    expect(sessions.rows.map((row) => row.id)).toEqual([freshVendorSession]);

    const verifications = await testDb.pool.query<{ id: string }>(
      "select id from vendor_auth_verifications order by id",
    );
    expect(verifications.rows.map((row) => row.id)).toEqual([freshVendorVerification]);

    const rateLimits = await testDb.pool.query<{ key: string }>(
      "select key from vendor_auth_rate_limits order by key",
    );
    expect(rateLimits.rows.map((row) => row.key)).toEqual(["vendor-fresh-ip"]);

    const emailLimits = await testDb.pool.query<{ key: string }>(
      "select key from vendor_auth_email_limits order by key",
    );
    expect(emailLimits.rows.map((row) => row.key)).toEqual(["vendor-fresh@example.com"]);

    const twoFactors = await testDb.pool.query("select 1 from vendor_auth_two_factors");
    expect(twoFactors.rowCount).toBe(1);

    const passkeys = await testDb.pool.query("select 1 from vendor_auth_passkeys");
    expect(passkeys.rowCount).toBe(1);
  });
});
