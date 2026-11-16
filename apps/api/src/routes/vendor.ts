import { randomBytes } from "node:crypto";

import { fromNodeHeaders } from "better-auth/node";
import { isAPIError } from "better-auth/api";
import { sql } from "drizzle-orm";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import {
  getVendorUserByEmail,
  getVendorUserById,
  listVendorUsers,
  resetVendorMfa,
  revokeVendorSessions,
  updateVendorUser,
  writeVendorAudit,
  type Database,
  type VendorAuditEvent,
  type VendorRole,
  type VendorUser,
  type VendorUserStatus,
} from "@partner-coder/db";

import { DatabaseEmailRateLimiter } from "../auth/email-rate-limit.js";
import { ApiError } from "../errors.js";
import {
  vendorStepUpSchema,
  vendorUserCreateSchema,
  vendorUserParamsSchema,
  vendorUserUpdateSchema,
} from "../openapi/schemas.js";
import { normalizeBaseUrl } from "../vendor-auth/base-url.js";
import { createVendorGuards } from "../vendor-auth/guard.js";
import type { VendorAuthRuntime } from "../vendor-auth/runtime.js";
import { parseBody, parseParams } from "./validation.js";

function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!local || !domain) {
    return "***";
  }
  return `${local.slice(0, 1)}***@${domain}`;
}

function resetRedirect(runtime: VendorAuthRuntime): string {
  return `${normalizeBaseUrl(runtime.vendorBaseUrl)}/reset-password`;
}

function statusAuditAction(status: VendorUserStatus): string {
  switch (status) {
    case "suspended":
      return "vendor.user.suspended";
    case "disabled":
      return "vendor.user.disabled";
    case "active":
      return "vendor.user.activated";
    case "invited":
      return "vendor.user.invited";
  }
}

async function auditBestEffort(
  request: FastifyRequest,
  runtime: VendorAuthRuntime,
  event: VendorAuditEvent,
): Promise<void> {
  try {
    await writeVendorAudit(runtime.db, event);
  } catch (error) {
    request.log.warn({ err: error, action: event.action }, "vendor_audit_failed");
  }
}

async function sendInvite(
  request: FastifyRequest,
  runtime: VendorAuthRuntime,
  user: VendorUser,
): Promise<void> {
  await runtime.auth.api.requestPasswordReset({
    body: { email: user.email, redirectTo: resetRedirect(runtime) },
  });
  await auditBestEffort(request, runtime, {
    actorId: request.vendorAuth!.userId,
    action: "vendor.user.invited",
    entity: "vendor_user",
    after: {
      userId: user.id,
      email: maskEmail(user.email),
      role: user.role,
      status: user.status,
    },
    ip: request.ip || null,
  });
}

async function inviteExisting(
  request: FastifyRequest,
  runtime: VendorAuthRuntime,
  user: VendorUser,
  requestedRole: VendorRole,
  reply: FastifyReply,
): Promise<FastifyReply> {
  if (user.status === "active") {
    throw new ApiError(409, "vendor_user_exists", "Пользователь уже активирован");
  }
  if (user.status === "suspended" || user.status === "disabled") {
    throw new ApiError(409, "vendor_user_inactive", "Учётная запись вендора заблокирована");
  }
  if (user.role !== requestedRole) {
    throw new ApiError(
      409,
      "vendor_user_exists",
      `Пользователь уже приглашён с ролью ${user.role}; измените роль через PATCH /v1/vendor/users/:id`,
    );
  }
  await sendInvite(request, runtime, user);
  return reply.status(200).send({ user });
}

export function registerVendorRoutes(server: FastifyInstance, runtime: VendorAuthRuntime): void {
  const guards = createVendorGuards(runtime);
  const userGuards = [
    guards.authenticateVendor,
    guards.requireVendorMfa,
    guards.requireVendorRole(["superadmin"]),
  ];
  const stepUpLimiter = new DatabaseEmailRateLimiter(runtime.authDb, {
    table: "vendor_auth_email_limits",
    limit: 5,
    windowMs: 5 * 60_000,
    onError: (error) => {
      server.log.error({ err: error }, "vendor_step_up_limiter_failed");
    },
  });

  server.get("/v1/vendor/auth/me", { preHandler: [guards.authenticateVendor] }, async (request) => {
    const identity = request.vendorAuth!;
    return {
      user: {
        id: identity.userId,
        email: identity.email,
        name: identity.name,
        role: identity.role,
        status: identity.status,
        twoFactorEnabled: identity.twoFactorEnabled,
      },
      mfaEnrollmentRequired: !identity.twoFactorEnabled,
      sessionExpiresAt: identity.sessionExpiresAt,
      stepUpUntil: identity.stepUpUntil,
    };
  });

  server.post(
    "/v1/vendor/auth/step-up",
    { preHandler: [guards.authenticateVendor, guards.requireVendorMfa] },
    async (request) => {
      const identity = request.vendorAuth!;
      const input = parseBody(vendorStepUpSchema, request.body);
      if (!(await stepUpLimiter.consume(`stepup:${identity.userId}`))) {
        throw new ApiError(429, "email_rate_limited", "Слишком много попыток подтверждения пароля");
      }

      try {
        await runtime.auth.api.verifyPassword({
          body: { password: input.password },
          headers: fromNodeHeaders(request.headers),
        });
      } catch (error) {
        if (!isAPIError(error) || (error.statusCode !== 400 && error.statusCode !== 401)) {
          throw error;
        }
        await auditBestEffort(request, runtime, {
          actorId: identity.userId,
          action: "vendor.auth.step_up_failed",
          entity: "vendor_session",
          after: { sessionId: identity.sessionId, reason: "invalid_password" },
          ip: request.ip || null,
        });
        throw new ApiError(400, "invalid_password", "Неверный пароль");
      }

      const result = await runtime.authDb.execute(sql`
        update vendor_auth_sessions
           set step_up_until = now() + make_interval(mins => ${runtime.stepUpMinutes}),
               updated_at = now()
         where id = ${identity.sessionId}
         returning step_up_until
      `);
      const raw = (result.rows[0] as { step_up_until?: Date | string } | undefined)?.step_up_until;
      if (!raw) {
        throw new ApiError(401, "vendor_unauthenticated", "Требуется вход вендора");
      }
      const stepUpUntil = raw instanceof Date ? raw : new Date(raw);

      await auditBestEffort(request, runtime, {
        actorId: identity.userId,
        action: "vendor.auth.step_up_succeeded",
        entity: "vendor_session",
        after: { sessionId: identity.sessionId, stepUpUntil: stepUpUntil.toISOString() },
        ip: request.ip || null,
      });

      return { stepUpUntil };
    },
  );

  server.get("/v1/vendor/users", { preHandler: userGuards }, async () => {
    return { items: await listVendorUsers(runtime.db) };
  });

  server.post("/v1/vendor/users", { preHandler: userGuards }, async (request, reply) => {
    const input = parseBody(vendorUserCreateSchema, request.body);
    const email = input.email.trim().toLowerCase();
    if (input.role === "superadmin" && input.confirmSuperadmin !== true) {
      throw new ApiError(
        400,
        "superadmin_confirmation_required",
        "Создание суперадминистратора требует подтверждения",
      );
    }

    const existing = await getVendorUserByEmail(runtime.db, email);
    if (existing) {
      return inviteExisting(request, runtime, existing, input.role, reply);
    }

    let vendorUserId: string;
    try {
      const created = await runtime.auth.api.signUpEmail({
        body: { email, name: input.name, password: randomBytes(32).toString("base64url") },
      });
      vendorUserId = created.user.id;
    } catch (error) {
      const raced = await getVendorUserByEmail(runtime.db, email);
      if (!raced) {
        throw error;
      }
      return inviteExisting(request, runtime, raced, input.role, reply);
    }

    const user = await updateVendorUser(runtime.db, vendorUserId, {
      role: input.role,
      status: "invited",
    });
    if (!user) {
      throw new Error(`Vendor user ${vendorUserId} not found after sign-up`);
    }

    await sendInvite(request, runtime, user);
    return reply.status(201).send({ user });
  });

  server.patch("/v1/vendor/users/:id", { preHandler: userGuards }, async (request) => {
    const identity = request.vendorAuth!;
    const { id } = parseParams(vendorUserParamsSchema, request.params);
    if (id === identity.userId) {
      throw new ApiError(
        409,
        "vendor_self_change_denied",
        "Нельзя изменить собственную учётную запись",
      );
    }

    const input = parseBody(vendorUserUpdateSchema, request.body);
    if (input.role === undefined && input.status === undefined) {
      throw new ApiError(400, "validation_error", "Некорректные данные запроса");
    }
    if (input.role === "superadmin" && input.confirmSuperadmin !== true) {
      throw new ApiError(
        400,
        "superadmin_confirmation_required",
        "Назначение суперадминистратора требует подтверждения",
      );
    }

    const current = await getVendorUserById(runtime.db, id);
    if (!current) {
      throw new ApiError(404, "vendor_user_not_found", "Пользователь не найден");
    }

    const updated = await runtime.db.transaction(async (tx) => {
      const txDb = tx as unknown as Database;
      const user = await updateVendorUser(txDb, id, {
        ...(input.role === undefined ? {} : { role: input.role }),
        ...(input.status === undefined ? {} : { status: input.status }),
      });
      if (!user) {
        return null;
      }

      if (input.role !== undefined && input.role !== current.role) {
        await writeVendorAudit(tx, {
          actorId: identity.userId,
          action: "vendor.user.role_changed",
          entity: "vendor_user",
          before: { role: current.role },
          after: { userId: id, role: user.role },
          ip: request.ip || null,
        });
      }
      if (input.status !== undefined && input.status !== current.status) {
        await writeVendorAudit(tx, {
          actorId: identity.userId,
          action: statusAuditAction(user.status),
          entity: "vendor_user",
          before: { status: current.status },
          after: { userId: id, status: user.status },
          ip: request.ip || null,
        });
      }
      return user;
    });

    if (!updated) {
      throw new ApiError(404, "vendor_user_not_found", "Пользователь не найден");
    }

    if (updated.status === "suspended" || updated.status === "disabled") {
      try {
        const count = await revokeVendorSessions(runtime.authDb, id);
        await auditBestEffort(request, runtime, {
          actorId: identity.userId,
          action: "vendor.session.revoked",
          entity: "vendor_user",
          after: { userId: id, count, reason: updated.status },
          ip: request.ip || null,
        });
      } catch (error) {
        request.log.warn({ err: error, vendorUserId: id }, "vendor_session_revoke_failed");
      }
    }

    return { user: updated };
  });

  server.post(
    "/v1/vendor/users/:id/reset-password",
    { preHandler: userGuards },
    async (request) => {
      const identity = request.vendorAuth!;
      const { id } = parseParams(vendorUserParamsSchema, request.params);
      const user = await getVendorUserById(runtime.db, id);
      if (!user) {
        throw new ApiError(404, "vendor_user_not_found", "Пользователь не найден");
      }
      if (user.status === "suspended" || user.status === "disabled") {
        throw new ApiError(409, "vendor_user_inactive", "Учётная запись вендора заблокирована");
      }

      await runtime.auth.api.requestPasswordReset({
        body: { email: user.email, redirectTo: resetRedirect(runtime) },
      });
      await auditBestEffort(request, runtime, {
        actorId: identity.userId,
        action: "vendor.user.password_reset_requested",
        entity: "vendor_user",
        after: { userId: user.id },
        ip: request.ip || null,
      });
      return { status: true };
    },
  );

  server.post("/v1/vendor/users/:id/reset-mfa", { preHandler: userGuards }, async (request) => {
    const identity = request.vendorAuth!;
    const { id } = parseParams(vendorUserParamsSchema, request.params);
    const user = await getVendorUserById(runtime.db, id);
    if (!user) {
      throw new ApiError(404, "vendor_user_not_found", "Пользователь не найден");
    }

    return resetVendorMfa(runtime.authDb, id, {
      actorId: identity.userId,
      ip: request.ip || null,
    });
  });
}
