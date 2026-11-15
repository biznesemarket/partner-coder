import type { FastifyInstance } from "fastify";

import {
  getDeviceTokenMembership,
  getTenantOverview,
  issueDeviceToken,
  listDeviceTokens,
  listTenantDays,
  listTenantMembers,
  listTenantProjects,
  revokeDeviceToken,
  rotateDeviceToken,
} from "@partner-coder/db";

import { ApiError } from "../errors.js";
import { auditAuthorizationDenied, createGuards } from "../auth/guard.js";
import type { AuthIdentity, AuthRuntime } from "../auth/runtime.js";
import { daysQuerySchema, deviceCreateSchema, deviceParamsSchema } from "../openapi/schemas.js";
import { parseBody, parseParams, parseQuery } from "./validation.js";

export function registerTenantRoutes(server: FastifyInstance, runtime: AuthRuntime): void {
  const guards = createGuards(runtime);

  server.get(
    "/v1/tenant/overview",
    { preHandler: [guards.authenticate, guards.permission("tenant", "read")] },
    async (request) => {
      const identity = request.auth!;
      return {
        tenantId: identity.activeTenantId,
        ...(await getTenantOverview(runtime.db, identity.activeTenantId!)),
      };
    },
  );

  server.get(
    "/v1/tenant/members",
    { preHandler: [guards.authenticate, guards.permission("membership", "read")] },
    async (request) => {
      const identity = request.auth!;
      return { items: await listTenantMembers(runtime.db, identity.activeTenantId!) };
    },
  );

  server.get(
    "/v1/tenant/projects",
    { preHandler: [guards.authenticate, guards.permission("project", "read")] },
    async (request) => {
      const identity = request.auth!;
      return { items: await listTenantProjects(runtime.db, identity.activeTenantId!) };
    },
  );

  server.get(
    "/v1/tenant/days",
    { preHandler: [guards.authenticate, guards.permission("day_record", "read")] },
    async (request) => {
      const identity = request.auth!;
      const query = parseQuery(daysQuerySchema, request.query);
      return {
        items: await listTenantDays(runtime.db, identity.activeTenantId!, query),
      };
    },
  );

  server.get(
    "/v1/me/devices",
    { preHandler: [guards.authenticate, guards.permission("device", "read")] },
    async (request) => {
      const identity = request.auth!;
      if (!identity.activeMembership) {
        throw new ApiError(403, "tenant_required", "Сначала выберите рабочее пространство");
      }
      return {
        items: await listDeviceTokens(
          runtime.db,
          identity.activeTenantId!,
          identity.activeMembership.membershipId,
        ),
      };
    },
  );

  server.post(
    "/v1/me/devices",
    {
      preHandler: [guards.authenticate, guards.permission("device", "create"), guards.sessionOnly],
    },
    async (request, reply) => {
      const identity = request.auth!;
      if (!identity.activeMembership) {
        throw new ApiError(403, "tenant_required", "Сначала выберите рабочее пространство");
      }
      const input = parseBody(deviceCreateSchema, request.body);
      const issued = await issueDeviceToken(runtime.db, {
        tenantId: identity.activeTenantId!,
        actorUserId: identity.userId,
        actorMembershipId: identity.activeMembership.membershipId,
        membershipId: identity.activeMembership.membershipId,
        ...(input.label === undefined ? {} : { label: input.label }),
        scope: input.scope,
        ...(input.ttlMinutes === undefined ? {} : { ttlMinutes: input.ttlMinutes }),
        ...(input.deviceId === undefined ? {} : { deviceId: input.deviceId }),
      });
      return reply.status(201).send({
        id: issued.id,
        token: issued.token,
        tokenPrefix: issued.tokenPrefix,
        expiresAt: issued.expiresAt,
      });
    },
  );

  async function assertCanManageDevice(
    requestTokenId: string,
    identity: AuthIdentity,
    allowCrossMembership: boolean,
    requestId: string,
  ): Promise<void> {
    const membershipId = await getDeviceTokenMembership(
      runtime.db,
      identity.activeTenantId!,
      requestTokenId,
    );
    if (!membershipId) {
      throw new ApiError(404, "device_token_not_found", "Токен не найден");
    }
    if (!allowCrossMembership && membershipId !== identity.activeMembership?.membershipId) {
      await auditAuthorizationDenied(
        runtime.db,
        identity,
        "device",
        "update",
        "device_ownership_denied",
        requestId,
      );
      throw new ApiError(
        403,
        "device_token_forbidden",
        "Ротация доступна только владельцу device-токена",
      );
    }
  }

  server.post(
    "/v1/me/devices/:id/rotate",
    {
      preHandler: [guards.authenticate, guards.permission("device", "update"), guards.sessionOnly],
    },
    async (request) => {
      const identity = request.auth!;
      const { id } = parseParams(deviceParamsSchema, request.params);
      await assertCanManageDevice(id, identity, false, request.id);
      const issued = await rotateDeviceToken(runtime.db, {
        tenantId: identity.activeTenantId!,
        actorUserId: identity.userId,
        actorMembershipId: identity.activeMembership!.membershipId,
        tokenId: id,
      });
      return {
        id: issued.id,
        token: issued.token,
        tokenPrefix: issued.tokenPrefix,
        expiresAt: issued.expiresAt,
      };
    },
  );

  server.delete(
    "/v1/me/devices/:id",
    { preHandler: [guards.authenticate, guards.permission("device", "delete")] },
    async (request, reply) => {
      const identity = request.auth!;
      const { id } = parseParams(deviceParamsSchema, request.params);
      await assertCanManageDevice(
        id,
        identity,
        identity.activeMembership?.role === "director",
        request.id,
      );
      const revoked = await revokeDeviceToken(runtime.db, {
        tenantId: identity.activeTenantId!,
        actorUserId: identity.userId,
        actorMembershipId: identity.activeMembership!.membershipId,
        tokenId: id,
        allowCrossMembership: identity.activeMembership!.role === "director",
      });
      if (!revoked) {
        throw new ApiError(404, "device_token_not_found", "Токен не найден");
      }
      return reply.status(204).send();
    },
  );
}
