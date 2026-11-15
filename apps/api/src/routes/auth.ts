import { fromNodeHeaders } from "better-auth/node";
import type { FastifyInstance } from "fastify";

import {
  acceptInvitation,
  createInvitation,
  inspectInvitation,
  listInvitations,
  revokeInvitation,
  setSessionActiveTenant,
} from "@partner-coder/db";

import { canAssignRole } from "@partner-coder/contracts";

import { ApiError } from "../errors.js";
import { auditAuthorizationDenied, createGuards } from "../auth/guard.js";
import { EmailRateLimiter, type EmailRateLimitStore } from "../auth/email-rate-limit.js";
import type { AuthRuntime } from "../auth/runtime.js";
import {
  invitationCreateSchema,
  invitationParamsSchema,
  tenantIdBodySchema,
  tokenParamsSchema,
} from "../openapi/schemas.js";
import { parseBody, parseParams } from "./validation.js";

function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!local || !domain) {
    return "***";
  }
  return `${local.slice(0, 1)}***@${domain}`;
}

const EMAIL_RATE_LIMITED_PATHS = new Set([
  "/api/auth/email-otp/send-verification-otp",
  "/api/auth/sign-in/email-otp",
  "/api/auth/sign-in/magic-link",
]);

export interface AuthRouteOptions {
  readonly emailRateLimit?: number | false;
  /** Общий store (PostgreSQL); без него используется memory-лимитер. */
  readonly emailRateLimitStore?: EmailRateLimitStore;
}

export function registerAuthRoutes(
  server: FastifyInstance,
  runtime: AuthRuntime,
  options: AuthRouteOptions = {},
): void {
  const guards = createGuards(runtime);
  const emailLimiter: EmailRateLimitStore | null =
    options.emailRateLimit === false
      ? null
      : (options.emailRateLimitStore ??
        new EmailRateLimiter({
          ...(options.emailRateLimit === undefined ? {} : { limit: options.emailRateLimit }),
        }));

  server.route({
    method: ["GET", "POST"],
    url: "/api/auth/*",
    async handler(request, reply) {
      const url = new URL(request.url, `http://${request.headers.host ?? "localhost"}`);
      if (EMAIL_RATE_LIMITED_PATHS.has(url.pathname)) {
        const email = (request.body as { email?: unknown } | undefined)?.email;
        if (emailLimiter && typeof email === "string" && !(await emailLimiter.consume(email))) {
          throw new ApiError(
            429,
            "email_rate_limited",
            "Слишком много попыток входа для этого email",
          );
        }
      }
      const headers = fromNodeHeaders(request.headers);
      const body = request.body === undefined ? undefined : JSON.stringify(request.body);
      const fetchRequest = new Request(url.toString(), {
        method: request.method,
        headers,
        ...(body === undefined ? {} : { body }),
      });

      const response = await runtime.auth.handler(fetchRequest);
      reply.status(response.status);
      response.headers.forEach((value, key) => {
        if (key.toLowerCase() !== "set-cookie") {
          reply.header(key, value);
        }
      });
      const cookies = response.headers.getSetCookie();
      if (cookies.length > 0) {
        reply.header("set-cookie", cookies);
      }
      const text = await response.text();
      return reply.send(text.length > 0 ? text : null);
    },
  });

  server.get("/v1/auth/me", { preHandler: guards.authenticate }, async (request) => {
    const identity = request.auth!;
    return {
      user: {
        id: identity.userId,
        email: identity.email,
        name: identity.name,
        emailVerified: identity.emailVerified,
        kind: identity.kind,
      },
      activeTenantId: identity.activeTenantId,
      memberships: identity.memberships.map((membership) => ({
        membershipId: membership.membershipId,
        tenantId: membership.tenantId,
        tenantName: membership.tenantName,
        tenantSlug: membership.tenantSlug,
        role: membership.role,
        status: membership.status,
      })),
    };
  });

  server.post("/v1/auth/tenant", { preHandler: guards.authenticate }, async (request) => {
    const identity = request.auth!;
    const { tenantId } = parseBody(tenantIdBodySchema, request.body);
    const membership = identity.memberships.find(
      (item) =>
        item.tenantId === tenantId &&
        item.status === "active" &&
        item.tenantStatus !== "suspended" &&
        item.tenantStatus !== "archived",
    );
    if (!membership) {
      throw new ApiError(403, "cross_tenant_denied", "Доступ к другому пространству запрещен");
    }
    if (identity.kind !== "session" || !identity.sessionId) {
      throw new ApiError(403, "session_required", "Выбор tenant доступен только веб-сессии");
    }
    await setSessionActiveTenant(runtime.db, {
      sessionId: identity.sessionId,
      userId: identity.userId,
      tenantId,
    });
    return {
      activeTenantId: tenantId,
      membership: {
        membershipId: membership.membershipId,
        role: membership.role,
      },
    };
  });

  server.get(
    "/v1/tenant/invitations",
    { preHandler: [guards.authenticate, guards.permission("invitation", "read")] },
    async (request) => {
      const identity = request.auth!;
      return { items: await listInvitations(runtime.db, identity.activeTenantId!) };
    },
  );

  server.post(
    "/v1/tenant/invitations",
    {
      config: { rateLimit: { max: 20, timeWindow: "1 minute" } },
      preHandler: [guards.authenticate, guards.permission("invitation", "create")],
    },
    async (request, reply) => {
      const identity = request.auth!;
      const input = parseBody(invitationCreateSchema, request.body);
      const actorRole = identity.activeMembership!.role;
      if (!canAssignRole(actorRole, input.role)) {
        await auditAuthorizationDenied(
          runtime.db,
          identity,
          "invitation",
          "create",
          "role_denied",
          request.id,
        );
        throw new ApiError(
          403,
          "role_assignment_denied",
          "Нельзя выдать приглашением роль выше своей",
        );
      }
      const created = await createInvitation(runtime.db, {
        tenantId: identity.activeTenantId!,
        actorUserId: identity.userId,
        actorRole: identity.activeMembership!.role,
        email: input.email,
        role: input.role,
        ...(input.ttlMinutes === undefined ? {} : { ttlMinutes: input.ttlMinutes }),
      });
      const inviteUrl = `${runtime.webBaseUrl}/invite?token=${encodeURIComponent(created.token)}`;
      return reply.status(201).send({
        id: created.id,
        expiresAt: created.expiresAt,
        inviteUrl,
        token: created.token,
      });
    },
  );

  server.delete(
    "/v1/tenant/invitations/:id",
    { preHandler: [guards.authenticate, guards.permission("invitation", "delete")] },
    async (request, reply) => {
      const identity = request.auth!;
      const { id } = parseParams(invitationParamsSchema, request.params);
      const revoked = await revokeInvitation(runtime.db, {
        tenantId: identity.activeTenantId!,
        actorUserId: identity.userId,
        invitationId: id,
      });
      if (!revoked) {
        throw new ApiError(404, "invitation_not_found", "Приглашение не найдено");
      }
      return reply.status(204).send();
    },
  );

  server.get("/v1/public/invitations/:token", async (request) => {
    const { token } = parseParams(tokenParamsSchema, request.params);
    const invitation = await inspectInvitation(runtime.db, token);
    const expired = invitation.status === "pending" && invitation.expiresAt.getTime() <= Date.now();
    return {
      tenantName: invitation.tenantName,
      email: maskEmail(invitation.email),
      role: invitation.role,
      status: expired ? "expired" : invitation.status,
      expiresAt: invitation.expiresAt,
    };
  });

  server.post(
    "/v1/auth/invitations/:token/accept",
    { preHandler: guards.authenticate },
    async (request) => {
      const identity = request.auth!;
      if (identity.kind !== "session" || !identity.email) {
        throw new ApiError(403, "session_required", "Принятие приглашения требует веб-сессии");
      }
      if (!identity.emailVerified) {
        throw new ApiError(403, "email_not_verified", "Email не подтвержден");
      }
      const { token } = parseParams(tokenParamsSchema, request.params);
      const accepted = await acceptInvitation(runtime.db, {
        token,
        userId: identity.userId,
      });
      if (identity.sessionId) {
        await setSessionActiveTenant(runtime.db, {
          sessionId: identity.sessionId,
          userId: identity.userId,
          tenantId: accepted.tenantId,
        });
      }
      return accepted;
    },
  );
}
