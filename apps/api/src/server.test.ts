import { describe, expect, it } from "vitest";

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
});
