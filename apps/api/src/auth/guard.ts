import type { FastifyRequest } from "fastify";

import {
  authorize,
  isTenantRole,
  type AuthzAction,
  type AuthzResource,
  type TenantRole,
} from "@partner-coder/contracts";
import { setTenantContext, writeAudit, type Database } from "@partner-coder/db";

import { ApiError } from "../errors.js";
import type { AuthIdentity, AuthRuntime } from "./runtime.js";

declare module "fastify" {
  interface FastifyRequest {
    auth?: AuthIdentity;
  }
}

const denialMessages = {
  cross_tenant: "Доступ к другому пространству запрещен",
  tenant_required: "Сначала выберите рабочее пространство",
  role_denied: "Недостаточно прав для этого действия",
} as const;

async function auditDenied(
  db: Database,
  identity: AuthIdentity,
  resource: AuthzResource,
  action: AuthzAction,
  reason: keyof typeof denialMessages,
  requestId: string,
): Promise<void> {
  if (!identity.activeTenantId) {
    return;
  }
  await db
    .transaction(async (tx) => {
      await setTenantContext(tx, {
        tenantId: identity.activeTenantId!,
        userId: identity.userId,
      });
      await writeAudit(tx, "authz.denied", `${resource}:${action}`, null, {
        reason,
        role: identity.activeMembership?.role ?? null,
        requestId,
        kind: identity.kind,
      });
    })
    .catch(() => undefined);
}

export function createGuards(runtime: AuthRuntime) {
  async function authenticate(request: FastifyRequest): Promise<void> {
    const identity = await runtime.resolveIdentity(request.headers);
    if (!identity) {
      throw new ApiError(401, "unauthenticated", "Требуется вход");
    }
    request.auth = identity;
  }

  function permission(resource: AuthzResource, action: AuthzAction) {
    return async (request: FastifyRequest): Promise<void> => {
      const identity = request.auth;
      if (!identity) {
        throw new ApiError(401, "unauthenticated", "Требуется вход");
      }
      if (!identity.activeTenantId || !identity.activeMembership) {
        await auditDenied(runtime.db, identity, resource, action, "tenant_required", request.id);
        throw new ApiError(403, "tenant_required", denialMessages.tenant_required);
      }
      const role = identity.activeMembership.role;
      if (!isTenantRole(role)) {
        throw new ApiError(403, "forbidden", denialMessages.role_denied);
      }
      const decision = authorize({
        role: role as TenantRole,
        resource,
        action,
        actorTenantId: identity.activeTenantId,
        resourceTenantId: identity.activeTenantId,
      });
      if (!decision.allowed) {
        await auditDenied(runtime.db, identity, resource, action, decision.reason, request.id);
        throw new ApiError(
          403,
          decision.reason === "cross_tenant" ? "cross_tenant_denied" : "forbidden",
          denialMessages[decision.reason],
        );
      }
    };
  }

  return { authenticate, permission };
}
