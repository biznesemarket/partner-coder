import { randomBytes, randomUUID } from "node:crypto";

import { and, eq, sql } from "drizzle-orm";

import { withTenantContext, type Database, type DbTransaction } from "../client.js";
import { invitations, memberships } from "../schema/index.js";
import { writeAudit } from "./audit.js";
import { AuthServiceError, type MembershipRole } from "./errors.js";
import { hashAuthToken } from "./hash.js";

const INVITATION_PREFIX = "pci_";
const DEFAULT_TTL_MINUTES = 7 * 24 * 60;

export interface CreateInvitationInput {
  readonly tenantId: string;
  readonly actorUserId: string;
  readonly email: string;
  readonly role: MembershipRole;
  readonly ttlMinutes?: number;
}

export interface CreatedInvitation {
  readonly id: string;
  readonly token: string;
  readonly expiresAt: Date;
}

export interface InvitationInspection {
  readonly id: string;
  readonly tenantId: string;
  readonly email: string;
  readonly role: MembershipRole;
  readonly status: string;
  readonly expiresAt: Date;
  readonly tenantName: string;
}

function createInvitationToken(): { token: string; tokenHash: string; tokenPrefix: string } {
  const token = `${INVITATION_PREFIX}${randomBytes(32).toString("base64url")}`;
  return { token, tokenHash: hashAuthToken(token), tokenPrefix: token.slice(0, 8) };
}

async function loadInvitationByTokenHash(
  db: Database,
  tokenHash: string,
): Promise<InvitationInspection | null> {
  const result = await db.execute(
    sql`select invitation_id, tenant_id, email, role, status, expires_at, tenant_name
          from auth_invitation_by_token_hash(${tokenHash})`,
  );
  const row = result.rows[0] as
    | {
        invitation_id: string;
        tenant_id: string;
        email: string;
        role: MembershipRole;
        status: string;
        expires_at: Date | string;
        tenant_name: string;
      }
    | undefined;
  if (!row) {
    return null;
  }
  return {
    id: row.invitation_id,
    tenantId: row.tenant_id,
    email: row.email,
    role: row.role,
    status: row.status,
    expiresAt: row.expires_at instanceof Date ? row.expires_at : new Date(row.expires_at),
    tenantName: row.tenant_name,
  };
}

export async function inspectInvitation(
  db: Database,
  token: string,
): Promise<InvitationInspection> {
  const invitation = await loadInvitationByTokenHash(db, hashAuthToken(token));
  if (!invitation) {
    throw new AuthServiceError("invitation_not_found", "Приглашение не найдено");
  }
  return invitation;
}

export async function createInvitation(
  db: Database,
  input: CreateInvitationInput,
): Promise<CreatedInvitation> {
  const { token, tokenHash, tokenPrefix } = createInvitationToken();
  const id = randomUUID();
  const expiresAt = new Date(Date.now() + (input.ttlMinutes ?? DEFAULT_TTL_MINUTES) * 60_000);

  await withTenantContext(
    db,
    { tenantId: input.tenantId, userId: input.actorUserId },
    async (tx) => {
      await tx.insert(invitations).values({
        id,
        tenantId: input.tenantId,
        email: input.email.trim().toLowerCase(),
        role: input.role,
        tokenHash,
        status: "pending",
        invitedBy: input.actorUserId,
        expiresAt,
      });
      await writeAudit(tx, "invitation.created", `invitation:${id}`, null, {
        email: input.email.trim().toLowerCase(),
        role: input.role,
        tokenPrefix,
        expiresAt: expiresAt.toISOString(),
      });
    },
  );

  return { id, token, expiresAt };
}

async function assertUserMatchesInvitation(
  tx: DbTransaction,
  invitation: InvitationInspection,
  userId: string,
): Promise<void> {
  const result = await tx.execute(sql`select id from auth_user_by_email(${invitation.email})`);
  const invitedUser = result.rows[0] as { id: string } | undefined;
  if (!invitedUser || invitedUser.id !== userId) {
    await writeAudit(tx, "invitation.accept_denied", `invitation:${invitation.id}`, null, {
      reason: "email_mismatch",
      userId,
    });
    throw new AuthServiceError("invitation_email_mismatch", "Приглашение выдано на другой email");
  }
}

export interface AcceptedInvitation {
  readonly invitationId: string;
  readonly tenantId: string;
  readonly membershipId: string;
  readonly role: MembershipRole;
}

export async function acceptInvitation(
  db: Database,
  input: { readonly token: string; readonly userId: string },
): Promise<AcceptedInvitation> {
  const invitation = await loadInvitationByTokenHash(db, hashAuthToken(input.token));
  if (!invitation) {
    throw new AuthServiceError("invitation_not_found", "Приглашение не найдено");
  }
  if (invitation.status === "accepted") {
    throw new AuthServiceError("invitation_used", "Приглашение уже использовано");
  }
  if (invitation.status !== "pending") {
    throw new AuthServiceError("invitation_used", "Приглашение отозвано");
  }
  if (invitation.expiresAt.getTime() <= Date.now()) {
    throw new AuthServiceError("invitation_expired", "Срок приглашения истек");
  }

  return withTenantContext(
    db,
    { tenantId: invitation.tenantId, userId: input.userId },
    async (tx) => {
      await assertUserMatchesInvitation(tx, invitation, input.userId);

      const [membership] = await tx
        .insert(memberships)
        .values({
          tenantId: invitation.tenantId,
          userId: input.userId,
          role: invitation.role,
          status: "active",
          joinedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [memberships.tenantId, memberships.userId],
          set: {
            status: "active",
            joinedAt: new Date(),
            updatedAt: new Date(),
          },
        })
        .returning({ id: memberships.id });

      const [accepted] = await tx
        .update(invitations)
        .set({ status: "accepted", acceptedAt: new Date() })
        .where(and(eq(invitations.id, invitation.id), eq(invitations.status, "pending")))
        .returning({ id: invitations.id });

      if (!accepted || !membership) {
        throw new AuthServiceError("invitation_used", "Приглашение уже использовано");
      }

      await writeAudit(tx, "invitation.accepted", `invitation:${invitation.id}`, null, {
        membershipId: membership.id,
        role: invitation.role,
        userId: input.userId,
      });

      return {
        invitationId: invitation.id,
        tenantId: invitation.tenantId,
        membershipId: membership.id,
        role: invitation.role,
      };
    },
  );
}

export async function revokeInvitation(
  db: Database,
  input: { readonly tenantId: string; readonly actorUserId: string; readonly invitationId: string },
): Promise<boolean> {
  return withTenantContext(
    db,
    { tenantId: input.tenantId, userId: input.actorUserId },
    async (tx) => {
      const [revoked] = await tx
        .update(invitations)
        .set({ status: "revoked" })
        .where(and(eq(invitations.id, input.invitationId), eq(invitations.status, "pending")))
        .returning({ id: invitations.id });
      if (!revoked) {
        return false;
      }
      await writeAudit(tx, "invitation.revoked", `invitation:${input.invitationId}`, null, {
        revokedBy: input.actorUserId,
      });
      return true;
    },
  );
}
