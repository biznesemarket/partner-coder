import { describe, expect, it } from "vitest";

import {
  signClientIp,
  TRUSTED_CLIENT_IP_HEADER,
  TRUSTED_CLIENT_IP_SIGNATURE_HEADER,
} from "@partner-coder/domain";

import { ApiError } from "./server.js";
import { buildServer } from "./server.js";

describe("api skeleton", () => {
  it("healthz отвечает ok и возвращает request id", async () => {
    const server = buildServer();
    const response = await server.inject({ method: "GET", url: "/healthz" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: "ok", version: "0.0.1" });
    expect(response.headers["x-request-id"]).toBeTruthy();
    await server.close();
  });

  it("неизвестный маршрут отдает конверт ошибки", async () => {
    const server = buildServer();
    const response = await server.inject({ method: "GET", url: "/nope" });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({
      error: { code: "not_found", requestId: expect.any(String) },
    });
    await server.close();
  });

  it("ApiError превращается в конверт с кодом и статусом", async () => {
    const server = buildServer();
    server.get("/boom", async () => {
      throw new ApiError(403, "cross_tenant_denied", "Доступ к другому пространству запрещен");
    });
    const response = await server.inject({ method: "GET", url: "/boom" });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({
      error: {
        code: "cross_tenant_denied",
        message: "Доступ к другому пространству запрещен",
        requestId: expect.any(String),
      },
    });
    await server.close();
  });

  it("принимает только подписанный client IP и удаляет подделку", async () => {
    const secret = "unit-test-trusted-client-ip-secret-32-bytes";
    const server = buildServer({ trustedClientIpSecret: secret });
    server.get("/test-client-ip", async (request) => ({
      verified: request.headers[TRUSTED_CLIENT_IP_HEADER] ?? null,
    }));

    const valid = await server.inject({
      method: "GET",
      url: "/test-client-ip",
      headers: {
        [TRUSTED_CLIENT_IP_HEADER]: "203.0.113.5",
        [TRUSTED_CLIENT_IP_SIGNATURE_HEADER]: signClientIp(secret, "203.0.113.5"),
      },
    });
    expect(valid.json()).toEqual({ verified: "203.0.113.5" });

    const forged = await server.inject({
      method: "GET",
      url: "/test-client-ip",
      headers: {
        [TRUSTED_CLIENT_IP_HEADER]: "203.0.113.5",
        [TRUSTED_CLIENT_IP_SIGNATURE_HEADER]: "0".repeat(64),
      },
    });
    expect(forged.json()).toEqual({ verified: null });
    await server.close();
  });

  it("без секрета удаляет client IP заголовки в любом случае", async () => {
    const server = buildServer();
    server.get("/test-client-ip", async (request) => ({
      verified: request.headers[TRUSTED_CLIENT_IP_HEADER] ?? null,
    }));

    const response = await server.inject({
      method: "GET",
      url: "/test-client-ip",
      headers: {
        [TRUSTED_CLIENT_IP_HEADER]: "203.0.113.5",
        [TRUSTED_CLIENT_IP_SIGNATURE_HEADER]: "0".repeat(64),
      },
    });
    expect(response.json()).toEqual({ verified: null });
    await server.close();
  });
  it("входящий x-request-id сохраняется", async () => {
    const server = buildServer();
    const response = await server.inject({
      method: "GET",
      url: "/healthz",
      headers: { "x-request-id": "req-123" },
    });
    expect(response.headers["x-request-id"]).toBe("req-123");
    await server.close();
  });

  it("отдает метрики Prometheus", async () => {
    const server = buildServer();
    const response = await server.inject({ method: "GET", url: "/metrics" });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/plain");
    expect(response.body).toContain("partner_coder_http_requests_total");
    await server.close();
  });

  it("закрывает метрики токеном, если он задан", async () => {
    const server = buildServer({ metricsToken: "metrics-secret" });
    const denied = await server.inject({ method: "GET", url: "/metrics" });
    expect(denied.statusCode).toBe(401);

    const allowed = await server.inject({
      method: "GET",
      url: "/metrics",
      headers: { authorization: "Bearer metrics-secret" },
    });
    expect(allowed.statusCode).toBe(200);
    await server.close();
  });

  it("отдает OpenAPI 3.1 из Zod-схем", async () => {
    const server = buildServer({ apiBaseUrl: "https://api.example.test" });
    const response = await server.inject({ method: "GET", url: "/openapi.json" });
    expect(response.statusCode).toBe(200);
    const body = response.json<{
      openapi: string;
      servers: { url: string }[];
      paths: Record<string, unknown>;
      components: { schemas: Record<string, unknown> };
    }>();
    expect(body.openapi).toBe("3.1.0");
    expect(body.servers[0]?.url).toBe("https://api.example.test");
    expect(body.paths).toHaveProperty("/v1/tenant/days");
    expect(body.paths).toHaveProperty("/v1/auth/me");
    expect(body.components.schemas).toHaveProperty("ErrorEnvelope");
    expect(body.components.schemas).toHaveProperty("AuthMeResponse");
    await server.close();
  });

  it("включает HSTS вне local и CORS для веб-кабинетов", async () => {
    const server = buildServer({
      appEnv: "staging",
      corsOrigins: ["https://app.pcoder.ru"],
    });
    const health = await server.inject({ method: "GET", url: "/healthz" });
    expect(health.headers["strict-transport-security"]).toContain("max-age=31536000");

    const preflight = await server.inject({
      method: "OPTIONS",
      url: "/v1/tenant/overview",
      headers: {
        origin: "https://app.pcoder.ru",
        "access-control-request-method": "GET",
      },
    });
    expect(preflight.statusCode).toBe(204);
    expect(preflight.headers["access-control-allow-origin"]).toBe("https://app.pcoder.ru");
    await server.close();
  });
});
