import { and, count, eq, max, sql } from "drizzle-orm";

import { setTenantContext, withTenantContext, type Database } from "../client.js";
import {
  dayRecords,
  deviceTokens,
  invitations,
  memberships,
  projects,
  users,
} from "../schema/index.js";
import type { MembershipRole, MembershipStatus } from "./errors.js";

export interface InvitationRecord {
  readonly id: string;
  readonly email: string;
  readonly role: MembershipRole;
  readonly status: string;
  readonly invitedBy: string | null;
  readonly expiresAt: Date;
  readonly acceptedAt: Date | null;
  readonly createdAt: Date;
}

export async function listInvitations(
  db: Database,
  tenantId: string,
): Promise<readonly InvitationRecord[]> {
  return withTenantContext(db, { tenantId }, async (tx) =>
    tx
      .select({
        id: invitations.id,
        email: invitations.email,
        role: invitations.role,
        status: invitations.status,
        invitedBy: invitations.invitedBy,
        expiresAt: invitations.expiresAt,
        acceptedAt: invitations.acceptedAt,
        createdAt: invitations.createdAt,
      })
      .from(invitations)
      .where(eq(invitations.tenantId, tenantId))
      .orderBy(invitations.createdAt),
  );
}

export interface TenantMember {
  readonly membershipId: string;
  readonly userId: string;
  readonly email: string;
  readonly name: string;
  readonly role: MembershipRole;
  readonly status: MembershipStatus;
  readonly displayName: string | null;
  readonly joinedAt: Date | null;
}

export async function listTenantMembers(
  db: Database,
  tenantId: string,
): Promise<readonly TenantMember[]> {
  return withTenantContext(db, { tenantId }, async (tx) =>
    tx
      .select({
        membershipId: memberships.id,
        userId: users.id,
        email: users.email,
        name: users.name,
        role: memberships.role,
        status: memberships.status,
        displayName: memberships.displayName,
        joinedAt: memberships.joinedAt,
      })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(eq(memberships.tenantId, tenantId))
      .orderBy(memberships.createdAt),
  );
}

export interface TenantOverview {
  readonly members: number;
  readonly activeMembers: number;
  readonly projects: number;
  readonly closedDays: number;
  readonly lastClosedDay: string | null;
}

export async function getTenantOverview(db: Database, tenantId: string): Promise<TenantOverview> {
  return withTenantContext(db, { tenantId }, async (tx) => {
    const [memberCount] = await tx
      .select({ value: count() })
      .from(memberships)
      .where(eq(memberships.tenantId, tenantId));
    const [activeMemberCount] = await tx
      .select({ value: count() })
      .from(memberships)
      .where(and(eq(memberships.tenantId, tenantId), eq(memberships.status, "active")));
    const [projectCount] = await tx
      .select({ value: count() })
      .from(projects)
      .where(and(eq(projects.tenantId, tenantId), eq(projects.status, "active")));
    const [dayCount] = await tx
      .select({ value: count() })
      .from(dayRecords)
      .where(eq(dayRecords.tenantId, tenantId));
    const [lastDay] = await tx
      .select({ value: max(dayRecords.dateLocal) })
      .from(dayRecords)
      .where(eq(dayRecords.tenantId, tenantId));

    return {
      members: Number(memberCount?.value ?? 0),
      activeMembers: Number(activeMemberCount?.value ?? 0),
      projects: Number(projectCount?.value ?? 0),
      closedDays: Number(dayCount?.value ?? 0),
      lastClosedDay: lastDay?.value ?? null,
    };
  });
}

export async function setSessionActiveTenant(
  db: Database,
  input: {
    readonly sessionId: string;
    readonly userId: string;
    readonly tenantId: string;
  },
): Promise<void> {
  await db.transaction(async (tx) => {
    await setTenantContext(tx, { tenantId: input.tenantId, userId: input.userId });
    await tx.execute(
      sql`update auth_sessions
             set active_tenant_id = ${input.tenantId}, updated_at = now()
           where id = ${input.sessionId} and user_id = ${input.userId}`,
    );
  });
}

export async function getDeviceTokenMembership(
  db: Database,
  tenantId: string,
  tokenId: string,
): Promise<string | null> {
  return withTenantContext(db, { tenantId }, async (tx) => {
    const [row] = await tx
      .select({ membershipId: deviceTokens.membershipId })
      .from(deviceTokens)
      .where(and(eq(deviceTokens.tenantId, tenantId), eq(deviceTokens.id, tokenId)))
      .limit(1);
    return row?.membershipId ?? null;
  });
}
