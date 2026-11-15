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
  device_scope_denied: "Device-токен не дает доступ к этому действию",
} as const;

export async function auditAuthorizationDenied(
  db: Database,
  identity: AuthIdentity,
  resource: AuthzResource,
  action: AuthzAction,
  reason: keyof typeof denialMessages | string,
  requestId: string,
): Promise<void> {
  if (!identity.activeTenantId) {
    return;
  }
  await db.transaction(async (tx) => {
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
  });
}

async function auditOrLog(
  request: FastifyRequest,
  runtime: AuthRuntime,
  identity: AuthIdentity,
  resource: AuthzResource,
  action: AuthzAction,
  reason: keyof typeof denialMessages | string,
): Promise<void> {
  try {
    await auditAuthorizationDenied(runtime.db, identity, resource, action, reason, request.id);
  } catch (error) {
    request.log.error({ err: error, resource, action, reason }, "authz_audit_failed");
  }
}

export function createGuards(runtime: AuthRuntime) {
  async function authenticate(request: FastifyRequest): Promise<void> {
    const identity = await runtime.resolveIdentity(request.headers);
    if (!identity) {
      throw new ApiError(401, "unauthenticated", "Требуется вход");
    }
    request.auth = identity;
  }

  async function sessionOnly(request: FastifyRequest): Promise<void> {
    if (request.auth?.kind !== "session") {
      throw new ApiError(403, "session_required", "Действие доступно только в веб-сессии");
    }
  }

  function permission(resource: AuthzResource, action: AuthzAction) {
    return async (request: FastifyRequest): Promise<void> => {
      const identity = request.auth;
      if (!identity) {
        throw new ApiError(401, "unauthenticated", "Требуется вход");
      }
      if (identity.kind === "device" && !(resource === "device" && action === "delete")) {
        await auditOrLog(request, runtime, identity, resource, action, "device_scope_denied");
        throw new ApiError(403, "device_scope_denied", denialMessages.device_scope_denied);
      }
      if (!identity.activeTenantId || !identity.activeMembership) {
        await auditOrLog(request, runtime, identity, resource, action, "tenant_required");
        throw new ApiError(403, "tenant_required", denialMessages.tenant_required);
      }
      const role = identity.activeMembership.role;
      if (!isTenantRole(role)) {
        await auditOrLog(request, runtime, identity, resource, action, "role_denied");
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
        await auditOrLog(request, runtime, identity, resource, action, decision.reason);
        throw new ApiError(
          403,
          decision.reason === "cross_tenant" ? "cross_tenant_denied" : "forbidden",
          denialMessages[decision.reason],
        );
      }
    };
  }

  return { authenticate, permission, sessionOnly };
}
