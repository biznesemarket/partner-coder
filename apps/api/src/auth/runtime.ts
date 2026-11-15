import type { IncomingHttpHeaders } from "node:http";

import { fromNodeHeaders } from "better-auth/node";

import {
  AuthServiceError,
  authenticateDeviceToken,
  listUserMemberships,
  type Database,
  type UserMembership,
} from "@partner-coder/db";

import type { Auth } from "./config.js";

export type AuthKind = "session" | "device";

export interface AuthIdentity {
  readonly kind: AuthKind;
  readonly userId: string;
  readonly email: string | null;
  readonly name: string | null;
  readonly emailVerified: boolean;
  readonly sessionId: string | null;
  readonly deviceTokenId: string | null;
  readonly deviceScope: string | null;
  readonly memberships: readonly UserMembership[];
  readonly activeTenantId: string | null;
  readonly activeMembership: UserMembership | null;
}

export interface AuthRuntime {
  readonly auth: Auth;
  readonly db: Database;
  readonly webBaseUrl: string;
  resolveIdentity(headers: IncomingHttpHeaders): Promise<AuthIdentity | null>;
}

function pickActiveMembership(
  memberships: readonly UserMembership[],
  preferredTenantId: string | null,
): UserMembership | null {
  const active = memberships.filter(
    (membership) =>
      membership.status === "active" &&
      membership.tenantStatus !== "suspended" &&
      membership.tenantStatus !== "archived",
  );
  if (preferredTenantId) {
    const preferred = active.find((membership) => membership.tenantId === preferredTenantId);
    if (preferred) {
      return preferred;
    }
  }
  return active.length === 1 ? (active[0] ?? null) : null;
}

function bearerToken(headers: IncomingHttpHeaders): string | null {
  const authorization = headers.authorization;
  if (typeof authorization !== "string") {
    return null;
  }
  const [scheme, token] = authorization.split(/\s+/, 2);
  if (!scheme || scheme.toLowerCase() !== "bearer" || !token) {
    return null;
  }
  return token;
}

export function createAuthRuntime(options: {
  readonly auth: Auth;
  readonly db: Database;
  readonly webBaseUrl: string;
}): AuthRuntime {
  return {
    auth: options.auth,
    db: options.db,
    webBaseUrl: options.webBaseUrl,
    async resolveIdentity(headers) {
      const session = await options.auth.api.getSession({
        headers: fromNodeHeaders(headers),
      });

      if (session?.user) {
        const userStatus = (session.user as { status?: string }).status;
        if (userStatus === "suspended" || userStatus === "deleted") {
          return null;
        }
        const memberships = await listUserMemberships(options.db, session.user.id);
        const sessionFields = session.session as typeof session.session & {
          activeTenantId?: string | null;
        };
        const activeMembership = pickActiveMembership(
          memberships,
          sessionFields.activeTenantId ?? null,
        );
        return {
          kind: "session",
          userId: session.user.id,
          email: session.user.email,
          name: session.user.name,
          emailVerified: session.user.emailVerified,
          sessionId: session.session.id,
          deviceTokenId: null,
          deviceScope: null,
          memberships,
          activeTenantId: activeMembership?.tenantId ?? null,
          activeMembership,
        };
      }

      const token = bearerToken(headers);
      if (!token || !token.startsWith("pcd_")) {
        return null;
      }

      try {
        const device = await authenticateDeviceToken(options.db, token);
        const memberships = await listUserMemberships(options.db, device.userId);
        const activeMembership =
          memberships.find(
            (membership) =>
              membership.membershipId === device.membershipId && membership.status === "active",
          ) ?? null;
        return {
          kind: "device",
          userId: device.userId,
          email: null,
          name: null,
          emailVerified: true,
          sessionId: null,
          deviceTokenId: device.tokenId,
          deviceScope: device.scope,
          memberships,
          activeTenantId: activeMembership?.tenantId ?? device.tenantId,
          activeMembership,
        };
      } catch (error) {
        if (error instanceof AuthServiceError) {
          return null;
        }
        throw error;
      }
    },
  };
}
