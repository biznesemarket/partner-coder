import { randomBytes, randomUUID } from "node:crypto";

import { and, desc, eq, isNull, sql } from "drizzle-orm";

import { withTenantContext, type Database, type DbTransaction } from "../client.js";
import { deviceTokens, memberships } from "../schema/index.js";
import { writeAudit } from "./audit.js";
import {
  AuthServiceError,
  type MembershipRole,
  type MembershipStatus,
  type UserStatus,
} from "./errors.js";
import { hashAuthToken } from "./hash.js";

const DEVICE_TOKEN_PREFIX = "pcd_";

function createDeviceToken(): { token: string; tokenHash: string; tokenPrefix: string } {
  const token = `${DEVICE_TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
  return { token, tokenHash: hashAuthToken(token), tokenPrefix: token.slice(0, 8) };
}

export interface IssueDeviceTokenInput {
  readonly tenantId: string;
  readonly actorUserId: string;
  readonly membershipId: string;
  readonly deviceId?: string | null;
  readonly scope?: string;
  readonly label?: string | null;
  readonly ttlMinutes?: number;
}

export interface IssuedDeviceToken {
  readonly id: string;
  readonly token: string;
  readonly tokenPrefix: string;
  readonly expiresAt: Date | null;
}

export interface DeviceIdentity {
  readonly tokenId: string;
  readonly tenantId: string;
  readonly membershipId: string;
  readonly userId: string;
  readonly role: MembershipRole;
  readonly membershipStatus: MembershipStatus;
  readonly userStatus: UserStatus;
  readonly scope: string;
}

export interface DeviceTokenRecord {
  readonly id: string;
  readonly membershipId: string;
  readonly deviceId: string | null;
  readonly tokenPrefix: string;
  readonly scope: string;
  readonly label: string | null;
  readonly expiresAt: Date | null;
  readonly revokedAt: Date | null;
  readonly lastUsedAt: Date | null;
  readonly createdAt: Date;
}

async function requireActiveMembership(
  tx: DbTransaction,
  tenantId: string,
  membershipId: string,
): Promise<void> {
  const [membership] = await tx
    .select({ id: memberships.id, status: memberships.status })
    .from(memberships)
    .where(and(eq(memberships.tenantId, tenantId), eq(memberships.id, membershipId)))
    .limit(1);
  if (!membership) {
    throw new AuthServiceError("membership_not_found", "Участник не найден");
  }
  if (membership.status !== "active") {
    throw new AuthServiceError("membership_inactive", "Участник не активен");
  }
}

async function insertDeviceToken(
  tx: DbTransaction,
  input: IssueDeviceTokenInput,
  rotatedFrom: string | null,
): Promise<IssuedDeviceToken> {
  const { token, tokenHash, tokenPrefix } = createDeviceToken();
  const id = randomUUID();
  const expiresAt = input.ttlMinutes ? new Date(Date.now() + input.ttlMinutes * 60_000) : null;

  await tx.insert(deviceTokens).values({
    id,
    tenantId: input.tenantId,
    membershipId: input.membershipId,
    deviceId: input.deviceId ?? null,
    tokenHash,
    tokenPrefix,
    scope: input.scope ?? "agent",
    label: input.label ?? null,
    expiresAt,
    rotatedFrom,
  });

  await writeAudit(tx, "device_token.issued", `device_token:${id}`, null, {
    membershipId: input.membershipId,
    tokenPrefix,
    scope: input.scope ?? "agent",
    rotatedFrom,
    expiresAt: expiresAt?.toISOString() ?? null,
  });

  return { id, token, tokenPrefix, expiresAt };
}

export async function issueDeviceToken(
  db: Database,
  input: IssueDeviceTokenInput,
): Promise<IssuedDeviceToken> {
  return withTenantContext(
    db,
    { tenantId: input.tenantId, userId: input.actorUserId },
    async (tx) => {
      await requireActiveMembership(tx, input.tenantId, input.membershipId);
      return insertDeviceToken(tx, input, null);
    },
  );
}

export async function authenticateDeviceToken(
  db: Database,
  token: string,
): Promise<DeviceIdentity> {
  const result = await db.execute(
    sql`select token_id, tenant_id, membership_id, user_id, membership_role,
               membership_status, user_status, scope, expires_at, revoked_at
          from auth_device_by_token_hash(${hashAuthToken(token)})`,
  );
  const row = result.rows[0] as
    | {
        token_id: string;
        tenant_id: string;
        membership_id: string;
        user_id: string;
        membership_role: MembershipRole;
        membership_status: MembershipStatus;
        user_status: UserStatus;
        scope: string;
        expires_at: Date | string | null;
        revoked_at: Date | string | null;
      }
    | undefined;

  if (!row) {
    throw new AuthServiceError("device_token_not_found", "Токен не найден");
  }
  if (row.revoked_at) {
    throw new AuthServiceError("device_token_revoked", "Токен отозван");
  }
  if (row.expires_at && new Date(row.expires_at).getTime() <= Date.now()) {
    throw new AuthServiceError("device_token_expired", "Срок токена истек");
  }
  if (row.membership_status !== "active") {
    throw new AuthServiceError("membership_inactive", "Участник не активен");
  }
  if (row.user_status !== "active") {
    throw new AuthServiceError("membership_inactive", "Пользователь не активен");
  }

  await db
    .transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.tenant_id', ${row.tenant_id}, true)`);
      await tx.execute(sql`select set_config('app.user_id', ${row.user_id}, true)`);
      await tx
        .update(deviceTokens)
        .set({ lastUsedAt: new Date(), updatedAt: new Date() })
        .where(eq(deviceTokens.id, row.token_id));
    })
    .catch(() => undefined);

  return {
    tokenId: row.token_id,
    tenantId: row.tenant_id,
    membershipId: row.membership_id,
    userId: row.user_id,
    role: row.membership_role,
    membershipStatus: row.membership_status,
    userStatus: row.user_status,
    scope: row.scope,
  };
}

export async function rotateDeviceToken(
  db: Database,
  input: { readonly tenantId: string; readonly actorUserId: string; readonly tokenId: string },
): Promise<IssuedDeviceToken> {
  return withTenantContext(
    db,
    { tenantId: input.tenantId, userId: input.actorUserId },
    async (tx) => {
      const [current] = await tx
        .select()
        .from(deviceTokens)
        .where(eq(deviceTokens.id, input.tokenId))
        .limit(1)
        .for("update");
      if (!current) {
        throw new AuthServiceError("device_token_not_found", "Токен не найден");
      }
      if (current.revokedAt) {
        throw new AuthServiceError("device_token_revoked", "Токен уже отозван");
      }

      const issued = await insertDeviceToken(
        tx,
        {
          tenantId: input.tenantId,
          actorUserId: input.actorUserId,
          membershipId: current.membershipId,
          deviceId: current.deviceId,
          scope: current.scope,
          label: current.label,
        },
        current.id,
      );

      await tx
        .update(deviceTokens)
        .set({ revokedAt: new Date(), updatedAt: new Date() })
        .where(eq(deviceTokens.id, current.id));
      await writeAudit(tx, "device_token.rotated", `device_token:${current.id}`, null, {
        newTokenId: issued.id,
        membershipId: current.membershipId,
      });

      return issued;
    },
  );
}

export async function revokeDeviceToken(
  db: Database,
  input: { readonly tenantId: string; readonly actorUserId: string; readonly tokenId: string },
): Promise<boolean> {
  return withTenantContext(
    db,
    { tenantId: input.tenantId, userId: input.actorUserId },
    async (tx) => {
      const [revoked] = await tx
        .update(deviceTokens)
        .set({ revokedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(deviceTokens.id, input.tokenId), isNull(deviceTokens.revokedAt)))
        .returning({ id: deviceTokens.id });
      if (!revoked) {
        return false;
      }
      await writeAudit(tx, "device_token.revoked", `device_token:${input.tokenId}`, null, {
        revokedBy: input.actorUserId,
      });
      return true;
    },
  );
}

export async function listDeviceTokens(
  db: Database,
  tenantId: string,
  membershipId: string,
): Promise<readonly DeviceTokenRecord[]> {
  const rows = await db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.tenant_id', ${tenantId}, true)`);
    return tx
      .select({
        id: deviceTokens.id,
        membershipId: deviceTokens.membershipId,
        deviceId: deviceTokens.deviceId,
        tokenPrefix: deviceTokens.tokenPrefix,
        scope: deviceTokens.scope,
        label: deviceTokens.label,
        expiresAt: deviceTokens.expiresAt,
        revokedAt: deviceTokens.revokedAt,
        lastUsedAt: deviceTokens.lastUsedAt,
        createdAt: deviceTokens.createdAt,
      })
      .from(deviceTokens)
      .where(and(eq(deviceTokens.tenantId, tenantId), eq(deviceTokens.membershipId, membershipId)))
      .orderBy(desc(deviceTokens.createdAt));
  });
  return rows;
}
