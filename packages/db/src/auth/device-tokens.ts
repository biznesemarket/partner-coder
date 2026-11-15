import { randomBytes, randomUUID } from "node:crypto";

import { and, desc, eq, isNull, sql } from "drizzle-orm";

import { withTenantContext, type Database, type DbTransaction } from "../client.js";
import { deviceTokens, devices, memberships } from "../schema/index.js";
import { writeAudit } from "./audit.js";
import {
  AuthServiceError,
  type MembershipRole,
  type MembershipStatus,
  type TenantStatus,
  type UserStatus,
} from "./errors.js";
import { hashAuthToken } from "./hash.js";

const DEVICE_TOKEN_PREFIX = "pcd_";
const DEFAULT_TTL_MINUTES = 90 * 24 * 60;

function createDeviceToken(): { token: string; tokenHash: string; tokenPrefix: string } {
  const token = `${DEVICE_TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
  return { token, tokenHash: hashAuthToken(token), tokenPrefix: token.slice(0, 8) };
}

export interface IssueDeviceTokenInput {
  readonly tenantId: string;
  readonly actorUserId: string;
  readonly actorMembershipId: string;
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
  readonly expiresAt: Date;
}

export interface DeviceIdentity {
  readonly tokenId: string;
  readonly tenantId: string;
  readonly membershipId: string;
  readonly userId: string;
  readonly role: MembershipRole;
  readonly membershipStatus: MembershipStatus;
  readonly userStatus: UserStatus;
  readonly tenantStatus: TenantStatus;
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

async function requireActiveDevice(
  tx: DbTransaction,
  tenantId: string,
  membershipId: string,
  deviceId: string,
): Promise<void> {
  const [device] = await tx
    .select({ id: devices.id })
    .from(devices)
    .where(
      and(
        eq(devices.tenantId, tenantId),
        eq(devices.id, deviceId),
        eq(devices.membershipId, membershipId),
        eq(devices.status, "active"),
        isNull(devices.revokedAt),
      ),
    )
    .limit(1);
  if (!device) {
    throw new AuthServiceError("device_not_found", "Активное устройство не найдено");
  }
}

async function insertDeviceToken(
  tx: DbTransaction,
  input: IssueDeviceTokenInput,
  rotatedFrom: string | null,
  expiresAtOverride?: Date,
): Promise<IssuedDeviceToken> {
  const { token, tokenHash, tokenPrefix } = createDeviceToken();
  const id = randomUUID();
  const expiresAt =
    expiresAtOverride ?? new Date(Date.now() + (input.ttlMinutes ?? DEFAULT_TTL_MINUTES) * 60_000);

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
    expiresAt: expiresAt.toISOString(),
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
      if (input.actorMembershipId !== input.membershipId) {
        throw new AuthServiceError(
          "device_token_forbidden",
          "Нельзя выпустить токен для чужого участника",
        );
      }
      await requireActiveMembership(tx, input.tenantId, input.membershipId);
      if (input.deviceId) {
        await requireActiveDevice(tx, input.tenantId, input.membershipId, input.deviceId);
      }
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
               membership_status, user_status, tenant_status, scope, expires_at, revoked_at
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
        tenant_status: TenantStatus;
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
  if (row.tenant_status === "suspended" || row.tenant_status === "archived") {
    throw new AuthServiceError("tenant_inactive", "Пространство приостановлено");
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
    tenantStatus: row.tenant_status,
    scope: row.scope,
  };
}

export async function rotateDeviceToken(
  db: Database,
  input: {
    readonly tenantId: string;
    readonly actorUserId: string;
    readonly actorMembershipId: string;
    readonly tokenId: string;
  },
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
      if (current.membershipId !== input.actorMembershipId) {
        throw new AuthServiceError(
          "device_token_forbidden",
          "Ротация доступна только владельцу device-токена",
        );
      }
      if (current.expiresAt && current.expiresAt.getTime() <= Date.now()) {
        throw new AuthServiceError("device_token_expired", "Срок токена истек");
      }
      await requireActiveMembership(tx, input.tenantId, current.membershipId);
      if (current.deviceId) {
        await requireActiveDevice(tx, input.tenantId, current.membershipId, current.deviceId);
      }

      const issued = await insertDeviceToken(
        tx,
        {
          tenantId: input.tenantId,
          actorUserId: input.actorUserId,
          actorMembershipId: input.actorMembershipId,
          membershipId: current.membershipId,
          deviceId: current.deviceId,
          scope: current.scope,
          label: current.label,
        },
        current.id,
        current.expiresAt ?? undefined,
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
  input: {
    readonly tenantId: string;
    readonly actorUserId: string;
    readonly actorMembershipId: string;
    readonly tokenId: string;
    readonly allowCrossMembership?: boolean;
  },
): Promise<boolean> {
  return withTenantContext(
    db,
    { tenantId: input.tenantId, userId: input.actorUserId },
    async (tx) => {
      const [current] = await tx
        .select({ id: deviceTokens.id, membershipId: deviceTokens.membershipId })
        .from(deviceTokens)
        .where(eq(deviceTokens.id, input.tokenId))
        .limit(1);
      if (!current) {
        return false;
      }
      if (!input.allowCrossMembership && current.membershipId !== input.actorMembershipId) {
        throw new AuthServiceError(
          "device_token_forbidden",
          "Отзыв доступен только владельцу device-токена",
        );
      }

      const result = await tx.execute(sql`
        with recursive family as (
          select id from device_tokens
           where id = ${input.tokenId} and tenant_id = ${input.tenantId}
          union all
          select child.id
            from device_tokens child
            join family parent on child.rotated_from = parent.id
           where child.tenant_id = ${input.tenantId}
        )
        update device_tokens
           set revoked_at = now(), updated_at = now()
         where id in (select id from family)
           and revoked_at is null
      `);

      const revokedCount = result.rowCount ?? 0;
      if (revokedCount === 0) {
        return false;
      }
      await writeAudit(tx, "device_token.revoked", `device_token:${input.tokenId}`, null, {
        revokedBy: input.actorUserId,
        revokedCount,
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
