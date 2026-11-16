import type { FastifyRequest } from "fastify";

import { revokeVendorSessions, writeVendorAudit, type VendorRole } from "@partner-coder/db";

import { ApiError } from "../errors.js";
import { resolveVendorIdentity, type VendorAuthRuntime, type VendorIdentity } from "./runtime.js";

declare module "fastify" {
  interface FastifyRequest {
    vendorAuth?: VendorIdentity;
  }
}

function requireIdentity(request: FastifyRequest): VendorIdentity {
  if (!request.vendorAuth) {
    throw new ApiError(401, "vendor_unauthenticated", "Требуется вход вендора");
  }
  return request.vendorAuth;
}

function auditPath(request: FastifyRequest): string {
  const routeUrl = request.routeOptions?.url;
  if (routeUrl) {
    return routeUrl;
  }
  const queryIndex = request.url.indexOf("?");
  return queryIndex === -1 ? request.url : request.url.slice(0, queryIndex);
}

async function revokeInactiveSessions(
  request: FastifyRequest,
  runtime: VendorAuthRuntime,
  identity: VendorIdentity,
): Promise<void> {
  try {
    await revokeVendorSessions(runtime.authDb, identity.userId);
  } catch (error) {
    request.log.error(
      { err: error, vendorUserId: identity.userId },
      "vendor_session_revoke_failed",
    );
  }
}

async function auditRoleDenied(
  request: FastifyRequest,
  runtime: VendorAuthRuntime,
  identity: VendorIdentity,
  roles: readonly VendorRole[],
): Promise<void> {
  try {
    await writeVendorAudit(runtime.db, {
      actorId: identity.userId,
      action: "vendor.auth.role_denied",
      entity: "vendor_api",
      after: {
        role: identity.role,
        requiredRoles: [...roles],
        method: request.method,
        path: auditPath(request),
      },
      ip: request.ip || null,
    });
  } catch (error) {
    request.log.error({ err: error, vendorUserId: identity.userId }, "vendor_role_audit_failed");
  }
}

export function createVendorGuards(runtime: VendorAuthRuntime) {
  async function authenticateVendor(request: FastifyRequest): Promise<void> {
    const identity = await resolveVendorIdentity(runtime, request.headers, request.log);
    if (!identity) {
      throw new ApiError(401, "vendor_unauthenticated", "Требуется вход вендора");
    }
    if (identity.status !== "invited" && identity.status !== "active") {
      await revokeInactiveSessions(request, runtime, identity);
      throw new ApiError(403, "vendor_inactive", "Учётная запись вендора заблокирована");
    }
    request.vendorAuth = identity;
  }

  async function requireVendorMfa(request: FastifyRequest): Promise<void> {
    const identity = requireIdentity(request);
    if (!identity.twoFactorEnabled) {
      throw new ApiError(403, "vendor_mfa_required", "Требуется включить TOTP");
    }
  }

  function requireVendorRole(roles: readonly VendorRole[]) {
    return async (request: FastifyRequest): Promise<void> => {
      const identity = requireIdentity(request);
      if (!roles.includes(identity.role)) {
        await auditRoleDenied(request, runtime, identity, roles);
        throw new ApiError(403, "vendor_role_denied", "Недостаточно прав");
      }
    };
  }

  async function requireVendorStepUp(request: FastifyRequest): Promise<void> {
    const identity = requireIdentity(request);
    if (!identity.stepUpUntil || identity.stepUpUntil.getTime() <= Date.now()) {
      throw new ApiError(
        403,
        "vendor_step_up_required",
        "Требуется повторное подтверждение пароля",
      );
    }
  }

  return { authenticateVendor, requireVendorMfa, requireVendorRole, requireVendorStepUp };
}
