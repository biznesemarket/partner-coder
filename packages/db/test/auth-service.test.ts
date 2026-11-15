import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { randomUUID } from "node:crypto";

import { createTestDatabase, type TestDatabase } from "./helpers.js";
import { seedTenant, seedVendorBase, type TenantFixture } from "./fixtures.js";
import {
  acceptInvitation,
  authenticateDeviceToken,
  createInvitation,
  inspectInvitation,
  issueDeviceToken,
  listDeviceTokens,
  listUserMemberships,
  revokeDeviceToken,
  rotateDeviceToken,
  type AuthServiceError,
} from "../src/auth/index.js";

let database: TestDatabase;
let tenant: TenantFixture;
let inviteeId: string;
let outsiderId: string;

function isAuthError(error: unknown, code: AuthServiceError["code"]): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    error.name === "AuthServiceError" &&
    "code" in error &&
    error.code === code
  );
}

async function createUser(email: string, name: string): Promise<string> {
  const id = randomUUID();
  await database.pool.query(
    `insert into users (id, email, name, status, email_verified)
     values ($1, $2, $3, 'active', true)`,
    [id, email, name],
  );
  return id;
}

beforeAll(async () => {
  database = await createTestDatabase();
  const base = await seedVendorBase(database.pool);
  tenant = await seedTenant(database.pool, base, "a");
  inviteeId = await createUser(`invitee-${randomUUID()}@example.com`, "Приглашенный");
  outsiderId = await createUser(`outsider-${randomUUID()}@example.com`, "Чужой");
}, 120_000);

afterAll(async () => {
  await database?.drop();
}, 60_000);

describe("приглашения", () => {
  it("создает приглашение, хранит только хеш и принимает его один раз", async () => {
    const inviteeEmail = (
      await database.pool.query<{ email: string }>("select email from users where id = $1", [
        inviteeId,
      ])
    ).rows[0]?.email;
    expect(inviteeEmail).toBeTruthy();

    const created = await createInvitation(database.db, {
      tenantId: tenant.tenantId,
      actorUserId: tenant.userId,
      actorRole: "director",
      email: inviteeEmail!,
      role: "developer",
      ttlMinutes: 60,
    });

    expect(created.token).toMatch(/^pci_/);
    expect(created.id).toBeTruthy();

    const stored = await database.pool.query<{ token_hash: string }>(
      "select token_hash from invitations where id = $1",
      [created.id],
    );
    expect(stored.rows[0]?.token_hash).not.toBe(created.token);
    expect(stored.rows[0]?.token_hash).toMatch(/^[0-9a-f]{64}$/);

    const inspected = await inspectInvitation(database.db, created.token);
    expect(inspected).toMatchObject({
      tenantId: tenant.tenantId,
      email: inviteeEmail,
      role: "developer",
      status: "pending",
    });

    const accepted = await acceptInvitation(database.db, {
      token: created.token,
      userId: inviteeId,
    });
    expect(accepted).toMatchObject({ tenantId: tenant.tenantId, role: "developer" });

    const membership = await database.pool.query<{ status: string; role: string }>(
      "select status, role from memberships where tenant_id = $1 and user_id = $2",
      [tenant.tenantId, inviteeId],
    );
    expect(membership.rows[0]).toEqual({ status: "active", role: "developer" });

    const invitation = await database.pool.query<{ status: string }>(
      "select status from invitations where id = $1",
      [created.id],
    );
    expect(invitation.rows[0]?.status).toBe("accepted");

    const chain = await database.pool.query<{ valid: boolean }>(
      "select verify_tenant_audit_chain($1) as valid",
      [tenant.tenantId],
    );
    expect(chain.rows[0]?.valid).toBe(true);

    await expect(
      acceptInvitation(database.db, { token: created.token, userId: inviteeId }),
    ).rejects.toSatisfy((error: unknown) => isAuthError(error, "invitation_used"));
  });

  it("не активирует повторно существующее членство", async () => {
    const directorEmail = (
      await database.pool.query<{ email: string }>("select email from users where id = $1", [
        tenant.userId,
      ])
    ).rows[0]?.email;

    const created = await createInvitation(database.db, {
      tenantId: tenant.tenantId,
      actorUserId: tenant.userId,
      actorRole: "director",
      email: directorEmail!,
      role: "developer",
    });
    await expect(
      acceptInvitation(database.db, { token: created.token, userId: tenant.userId }),
    ).rejects.toSatisfy((error: unknown) => isAuthError(error, "membership_exists"));

    const membership = await database.pool.query<{ role: string; status: string }>(
      "select role, status from memberships where tenant_id = $1 and user_id = $2",
      [tenant.tenantId, tenant.userId],
    );
    expect(membership.rows[0]).toEqual({ role: "director", status: "active" });
  });

  it("support не может пригласить director или finance", async () => {
    const email = `support-target-${randomUUID()}@example.com`;
    await expect(
      createInvitation(database.db, {
        tenantId: tenant.tenantId,
        actorUserId: tenant.userId,
        actorRole: "support",
        email,
        role: "director",
      }),
    ).rejects.toSatisfy((error: unknown) => isAuthError(error, "role_assignment_denied"));
    await expect(
      createInvitation(database.db, {
        tenantId: tenant.tenantId,
        actorUserId: tenant.userId,
        actorRole: "support",
        email,
        role: "finance",
      }),
    ).rejects.toSatisfy((error: unknown) => isAuthError(error, "role_assignment_denied"));
  });

  it("не принимает приглашение чужим email", async () => {
    const inviteeEmail = (
      await database.pool.query<{ email: string }>("select email from users where id = $1", [
        inviteeId,
      ])
    ).rows[0]?.email;

    const created = await createInvitation(database.db, {
      tenantId: tenant.tenantId,
      actorUserId: tenant.userId,
      actorRole: "director",
      email: inviteeEmail!,
      role: "developer",
    });

    await expect(
      acceptInvitation(database.db, { token: created.token, userId: outsiderId }),
    ).rejects.toSatisfy((error: unknown) => isAuthError(error, "invitation_email_mismatch"));

    const audit = await database.pool.query<{ action: string }>(
      `select action from tenant_audit_events
        where tenant_id = $1 and entity = $2 and action = 'invitation.accept_denied'
        order by chain_seq desc limit 1`,
      [tenant.tenantId, `invitation:${created.id}`],
    );
    expect(audit.rows).toHaveLength(1);
  });

  it("не принимает просроченное приглашение", async () => {
    const inviteeEmail = (
      await database.pool.query<{ email: string }>("select email from users where id = $1", [
        inviteeId,
      ])
    ).rows[0]?.email;

    const created = await createInvitation(database.db, {
      tenantId: tenant.tenantId,
      actorUserId: tenant.userId,
      actorRole: "director",
      email: inviteeEmail!,
      role: "developer",
      ttlMinutes: 5,
    });
    await database.pool.query(
      "update invitations set expires_at = now() - interval '1 minute' where id = $1",
      [created.id],
    );

    await expect(
      acceptInvitation(database.db, { token: created.token, userId: inviteeId }),
    ).rejects.toSatisfy((error: unknown) => isAuthError(error, "invitation_expired"));
  });
});

describe("device tokens", () => {
  it("выпускает токен, хранит хеш, ротирует и отзывает", async () => {
    const issued = await issueDeviceToken(database.db, {
      tenantId: tenant.tenantId,
      actorUserId: tenant.userId,
      actorMembershipId: tenant.membershipId,
      membershipId: tenant.membershipId,
      label: "CI",
      scope: "agent",
    });

    expect(issued.token).toMatch(/^pcd_/);
    expect(issued.expiresAt).toBeInstanceOf(Date);
    const stored = await database.pool.query<{ token_hash: string }>(
      "select token_hash from device_tokens where id = $1",
      [issued.id],
    );
    expect(stored.rows[0]?.token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(stored.rows[0]?.token_hash).not.toBe(issued.token);

    const identity = await authenticateDeviceToken(database.db, issued.token);
    expect(identity).toMatchObject({
      tenantId: tenant.tenantId,
      membershipId: tenant.membershipId,
      userId: tenant.userId,
      role: "director",
      scope: "agent",
    });

    const rotated = await rotateDeviceToken(database.db, {
      tenantId: tenant.tenantId,
      actorUserId: tenant.userId,
      actorMembershipId: tenant.membershipId,
      tokenId: issued.id,
    });
    expect(rotated.token).toMatch(/^pcd_/);
    expect(rotated.token).not.toBe(issued.token);
    expect(Math.abs(rotated.expiresAt.getTime() - issued.expiresAt.getTime())).toBeLessThan(1000);

    await expect(authenticateDeviceToken(database.db, issued.token)).rejects.toSatisfy(
      (error: unknown) => isAuthError(error, "device_token_revoked"),
    );
    const rotatedIdentity = await authenticateDeviceToken(database.db, rotated.token);
    expect(rotatedIdentity.membershipId).toBe(tenant.membershipId);

    await revokeDeviceToken(database.db, {
      tenantId: tenant.tenantId,
      actorUserId: tenant.userId,
      actorMembershipId: tenant.membershipId,
      tokenId: rotated.id,
    });
    await expect(authenticateDeviceToken(database.db, rotated.token)).rejects.toSatisfy(
      (error: unknown) => isAuthError(error, "device_token_revoked"),
    );

    const list = await listDeviceTokens(database.db, tenant.tenantId, tenant.membershipId);
    expect(list.find((item) => item.id === rotated.id)?.revokedAt).toBeTruthy();
  });

  it("не аутентифицирует device-токен приостановленного пользователя", async () => {
    const issued = await issueDeviceToken(database.db, {
      tenantId: tenant.tenantId,
      actorUserId: tenant.userId,
      actorMembershipId: tenant.membershipId,
      membershipId: tenant.membershipId,
    });
    await database.pool.query("update users set status = 'suspended' where id = $1", [
      tenant.userId,
    ]);
    try {
      await expect(authenticateDeviceToken(database.db, issued.token)).rejects.toSatisfy(
        (error: unknown) => isAuthError(error, "membership_inactive"),
      );
    } finally {
      await database.pool.query("update users set status = 'active' where id = $1", [
        tenant.userId,
      ]);
    }
  });

  it("не ротирует чужой device-токен и не привязывает чужое устройство", async () => {
    const outsiderMembership = randomUUID();
    const outsiderDevice = randomUUID();
    await database.pool.query(
      `insert into memberships (id, tenant_id, user_id, role, status, joined_at)
       values ($1, $2, $3, 'developer', 'active', now())`,
      [outsiderMembership, tenant.tenantId, outsiderId],
    );
    await database.pool.query(
      `insert into devices (id, tenant_id, membership_id, public_key, name, os, status)
       values ($1, $2, $3, $4, 'Чужой ноутбук', 'Windows', 'active')`,
      [outsiderDevice, tenant.tenantId, outsiderMembership, `key-${outsiderDevice}`],
    );

    const foreignToken = await issueDeviceToken(database.db, {
      tenantId: tenant.tenantId,
      actorUserId: outsiderId,
      actorMembershipId: outsiderMembership,
      membershipId: outsiderMembership,
      deviceId: outsiderDevice,
    });

    await expect(
      rotateDeviceToken(database.db, {
        tenantId: tenant.tenantId,
        actorUserId: tenant.userId,
        actorMembershipId: tenant.membershipId,
        tokenId: foreignToken.id,
      }),
    ).rejects.toSatisfy((error: unknown) => isAuthError(error, "device_token_forbidden"));

    await expect(
      issueDeviceToken(database.db, {
        tenantId: tenant.tenantId,
        actorUserId: tenant.userId,
        actorMembershipId: tenant.membershipId,
        membershipId: tenant.membershipId,
        deviceId: outsiderDevice,
      }),
    ).rejects.toSatisfy((error: unknown) => isAuthError(error, "device_not_found"));
  });

  it("не аутентифицирует токен отозванного устройства", async () => {
    const issued = await issueDeviceToken(database.db, {
      tenantId: tenant.tenantId,
      actorUserId: tenant.userId,
      actorMembershipId: tenant.membershipId,
      membershipId: tenant.membershipId,
      deviceId: tenant.deviceId,
    });
    await database.pool.query("update devices set status = 'revoked' where id = $1", [
      tenant.deviceId,
    ]);
    try {
      await expect(authenticateDeviceToken(database.db, issued.token)).rejects.toSatisfy(
        (error: unknown) => isAuthError(error, "device_token_not_found"),
      );
    } finally {
      await database.pool.query("update devices set status = 'active' where id = $1", [
        tenant.deviceId,
      ]);
    }
  });
  it("не пускает в приостановленный tenant и возвращает его статус", async () => {
    const issued = await issueDeviceToken(database.db, {
      tenantId: tenant.tenantId,
      actorUserId: tenant.userId,
      actorMembershipId: tenant.membershipId,
      membershipId: tenant.membershipId,
    });

    const memberships = await listUserMemberships(database.db, tenant.userId);
    expect(memberships[0]?.tenantStatus).toBe("active");

    await database.pool.query("update tenants set status = 'suspended' where id = $1", [
      tenant.tenantId,
    ]);
    try {
      await expect(authenticateDeviceToken(database.db, issued.token)).rejects.toSatisfy(
        (error: unknown) => isAuthError(error, "tenant_inactive"),
      );
      const suspended = await listUserMemberships(database.db, tenant.userId);
      expect(suspended[0]?.tenantStatus).toBe("suspended");
    } finally {
      await database.pool.query("update tenants set status = 'active' where id = $1", [
        tenant.tenantId,
      ]);
    }
  });

  it("не принимает приглашение в приостановленный tenant", async () => {
    const inviteeEmail = (
      await database.pool.query<{ email: string }>("select email from users where id = $1", [
        inviteeId,
      ])
    ).rows[0]?.email;
    const created = await createInvitation(database.db, {
      tenantId: tenant.tenantId,
      actorUserId: tenant.userId,
      actorRole: "director",
      email: inviteeEmail!,
      role: "developer",
    });
    await database.pool.query("update tenants set status = 'suspended' where id = $1", [
      tenant.tenantId,
    ]);
    try {
      await expect(
        acceptInvitation(database.db, { token: created.token, userId: inviteeId }),
      ).rejects.toSatisfy((error: unknown) => isAuthError(error, "tenant_inactive"));
    } finally {
      await database.pool.query("update tenants set status = 'active' where id = $1", [
        tenant.tenantId,
      ]);
    }
  });
  it("не выпускает токен на чужое membership", async () => {
    await expect(
      issueDeviceToken(database.db, {
        tenantId: tenant.tenantId,
        actorUserId: tenant.userId,
        actorMembershipId: tenant.membershipId,
        membershipId: randomUUID(),
      }),
    ).rejects.toSatisfy((error: unknown) => isAuthError(error, "device_token_forbidden"));
  });
});
