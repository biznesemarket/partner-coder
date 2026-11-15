import { randomBytes, randomUUID } from "node:crypto";

import { and, eq, sql } from "drizzle-orm";

import { withTenantContext, type Database } from "../client.js";
import { invitations, memberships } from "../schema/index.js";
import { writeAudit, writeDenialAudit } from "./audit.js";
import { AuthServiceError, type MembershipRole, type TenantStatus } from "./errors.js";
import { hashAuthToken } from "./hash.js";

const INVITATION_PREFIX = "pci_";
const DEFAULT_TTL_MINUTES = 7 * 24 * 60;

export interface CreateInvitationInput {
  readonly tenantId: string;
  readonly actorUserId: string;
  readonly actorRole: MembershipRole;
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
  readonly tenantStatus: TenantStatus;
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
    sql`select invitation_id, tenant_id, email, role, status, expires_at, tenant_name, tenant_status
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
        tenant_status: TenantStatus;
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
    tenantStatus: row.tenant_status,
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
  const canAssign =
    input.actorRole === "director" || (input.actorRole === "support" && input.role === "developer");
  if (!canAssign) {
    throw new AuthServiceError(
      "role_assignment_denied",
      "Нельзя выдать приглашением роль выше своей",
    );
  }

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

async function userMatchesInvitation(
  db: Database,
  invitation: InvitationInspection,
  userId: string,
): Promise<boolean> {
  const result = await db.execute(sql`select id from auth_user_by_email(${invitation.email})`);
  const invitedUser = result.rows[0] as { id: string } | undefined;
  return Boolean(invitedUser && invitedUser.id === userId);
}

async function denyInvitation(
  db: Database,
  invitation: InvitationInspection,
  userId: string,
  reason: string,
  code:
    | "invitation_email_mismatch"
    | "invitation_used"
    | "invitation_expired"
    | "membership_exists"
    | "tenant_inactive",
  message: string,
): Promise<never> {
  await writeDenialAudit(db, {
    tenantId: invitation.tenantId,
    userId,
    action: "invitation.accept_denied",
    entity: `invitation:${invitation.id}`,
    reason,
    role: invitation.role,
  });
  throw new AuthServiceError(code, message);
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
    await denyInvitation(
      db,
      invitation,
      input.userId,
      "invitation_accepted",
      "invitation_used",
      "Приглашение уже использовано",
    );
  }
  if (invitation.status !== "pending") {
    await denyInvitation(
      db,
      invitation,
      input.userId,
      "invitation_revoked",
      "invitation_used",
      "Приглашение отозвано",
    );
  }
  if (invitation.tenantStatus === "suspended" || invitation.tenantStatus === "archived") {
    await denyInvitation(
      db,
      invitation,
      input.userId,
      "tenant_inactive",
      "tenant_inactive",
      "Пространство приостановлено",
    );
  }
  if (invitation.expiresAt.getTime() <= Date.now()) {
    await denyInvitation(
      db,
      invitation,
      input.userId,
      "invitation_expired",
      "invitation_expired",
      "Срок приглашения истек",
    );
  }
  if (!(await userMatchesInvitation(db, invitation, input.userId))) {
    await denyInvitation(
      db,
      invitation,
      input.userId,
      "email_mismatch",
      "invitation_email_mismatch",
      "Приглашение выдано на другой email",
    );
  }

  const accepted = await withTenantContext(
    db,
    { tenantId: invitation.tenantId, userId: input.userId },
    async (tx): Promise<AcceptedInvitation | null> => {
      const [membership] = await tx
        .insert(memberships)
        .values({
          tenantId: invitation.tenantId,
          userId: input.userId,
          role: invitation.role,
          status: "active",
          joinedAt: new Date(),
        })
        .onConflictDoNothing({ target: [memberships.tenantId, memberships.userId] })
        .returning({ id: memberships.id });

      if (!membership) {
        return null;
      }

      const [acceptedInvitation] = await tx
        .update(invitations)
        .set({ status: "accepted", acceptedAt: new Date() })
        .where(and(eq(invitations.id, invitation.id), eq(invitations.status, "pending")))
        .returning({ id: invitations.id });

      if (!acceptedInvitation) {
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

  if (!accepted) {
    await denyInvitation(
      db,
      invitation,
      input.userId,
      "membership_exists",
      "membership_exists",
      "Пользователь уже состоит в этом пространстве",
    );
    throw new Error("unreachable");
  }
  return accepted;
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
