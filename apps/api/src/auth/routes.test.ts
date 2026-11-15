import { describe, expect, it } from "vitest";

import type { Database, UserMembership } from "@partner-coder/db";

import { buildServer } from "../server.js";
import type { Auth } from "./config.js";
import type { AuthIdentity, AuthRuntime } from "./runtime.js";

const membership: UserMembership = {
  membershipId: "11111111-1111-4111-8111-111111111111",
  tenantId: "22222222-2222-4222-8222-222222222222",
  role: "director",
  status: "active",
  tenantName: "Демо",
  tenantSlug: "demo",
  tenantTimezone: "Europe/Moscow",
  tenantStatus: "active",
  joinedAt: new Date("2026-11-01T00:00:00Z"),
};

function identity(overrides: Partial<AuthIdentity> = {}): AuthIdentity {
  return {
    kind: "session",
    userId: "33333333-3333-4333-8333-333333333333",
    email: "director@example.com",
    name: "Директор",
    emailVerified: true,
    sessionId: "44444444-4444-4444-8444-444444444444",
    deviceTokenId: null,
    deviceScope: null,
    memberships: [membership],
    activeTenantId: membership.tenantId,
    activeMembership: membership,
    ...overrides,
  };
}

function fakeRuntime(
  current: AuthIdentity | null,
  options: { onTransaction?: () => void } = {},
): AuthRuntime {
  const db = {
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      options.onTransaction?.();
      return fn({ execute: async () => ({ rows: [] }) });
    },
  } as unknown as Database;

  return {
    auth: { handler: async () => new Response("", { status: 404 }) } as unknown as Auth,
    db,
    webBaseUrl: "http://localhost:3000",
    resolveIdentity: async () => current,
  };
}

describe("API authz middleware", () => {
  it("без сессии отдает 401", async () => {
    const server = buildServer({ authRuntime: fakeRuntime(null) });
    const response = await server.inject({ method: "GET", url: "/v1/auth/me" });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ error: { code: "unauthenticated" } });
    await server.close();
  });

  it("возвращает профиль и членства аутентифицированного пользователя", async () => {
    const server = buildServer({ authRuntime: fakeRuntime(identity()) });
    const response = await server.inject({ method: "GET", url: "/v1/auth/me" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      user: { id: identity().userId, email: "director@example.com", kind: "session" },
      activeTenantId: membership.tenantId,
      memberships: [{ tenantId: membership.tenantId, role: "director" }],
    });
    await server.close();
  });

  it("запрещает роль без права и пишет отказ в аудит", async () => {
    let audited = 0;
    const developerMembership: UserMembership = {
      ...membership,
      role: "developer",
    };
    const server = buildServer({
      authRuntime: fakeRuntime(
        identity({
          memberships: [developerMembership],
          activeMembership: developerMembership,
        }),
        { onTransaction: () => (audited += 1) },
      ),
    });
    const response = await server.inject({
      method: "POST",
      url: "/v1/tenant/invitations",
      payload: { email: "new@example.com", role: "developer" },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ error: { code: "forbidden" } });
    expect(audited).toBe(1);
    await server.close();
  });

  it("support не может выдать приглашением director", async () => {
    const supportMembership: UserMembership = { ...membership, role: "support" };
    let audited = 0;
    const server = buildServer({
      authRuntime: fakeRuntime(
        identity({
          memberships: [supportMembership],
          activeMembership: supportMembership,
        }),
        { onTransaction: () => (audited += 1) },
      ),
    });
    const response = await server.inject({
      method: "POST",
      url: "/v1/tenant/invitations",
      payload: { email: "new@example.com", role: "director" },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ error: { code: "role_assignment_denied" } });
    expect(audited).toBe(1);
    await server.close();
  });

  it("device-токен не получает tenant-маршруты", async () => {
    const device = identity({
      kind: "device",
      email: null,
      name: null,
      sessionId: null,
      deviceTokenId: "55555555-5555-4555-8555-555555555555",
      deviceScope: "agent",
    });
    const server = buildServer({ authRuntime: fakeRuntime(device) });
    const response = await server.inject({ method: "GET", url: "/v1/tenant/overview" });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ error: { code: "device_scope_denied" } });
    await server.close();
  });

  it("некорректный JSON отдает 400, а не 500", async () => {
    const server = buildServer({ authRuntime: fakeRuntime(identity()) });
    const response = await server.inject({
      method: "POST",
      url: "/v1/auth/tenant",
      headers: { "content-type": "application/json" },
      payload: "{",
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: { code: "FST_ERR_CTP_INVALID_JSON_BODY" },
    });
    await server.close();
  });
  it("не дает выбрать чужой tenant", async () => {
    const server = buildServer({ authRuntime: fakeRuntime(identity()) });
    const response = await server.inject({
      method: "POST",
      url: "/v1/auth/tenant",
      payload: { tenantId: "99999999-9999-4999-8999-999999999999" },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ error: { code: "cross_tenant_denied" } });
    await server.close();
  });

  it("разрешает выбрать свой tenant и обновляет сессию", async () => {
    let transaction = 0;
    const server = buildServer({
      authRuntime: fakeRuntime(identity(), { onTransaction: () => (transaction += 1) }),
    });
    const response = await server.inject({
      method: "POST",
      url: "/v1/auth/tenant",
      payload: { tenantId: membership.tenantId },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ activeTenantId: membership.tenantId });
    expect(transaction).toBe(1);
    await server.close();
  });

  it("device-токен аутентифицируется как отдельный вид identity", async () => {
    const device = identity({
      kind: "device",
      email: null,
      name: null,
      sessionId: null,
      deviceTokenId: "55555555-5555-4555-8555-555555555555",
      deviceScope: "agent",
    });
    const server = buildServer({ authRuntime: fakeRuntime(device) });
    const response = await server.inject({ method: "GET", url: "/v1/auth/me" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      user: { id: device.userId, kind: "device" },
      activeTenantId: membership.tenantId,
    });
    await server.close();
  });
});
