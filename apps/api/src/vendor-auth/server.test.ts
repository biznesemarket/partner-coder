import { afterEach, describe, expect, it } from "vitest";

import type { Database } from "@partner-coder/db";

import { buildServer } from "../server.js";
import type { VendorAuth } from "./config.js";
import type { VendorAuthRuntime } from "./runtime.js";

const vendorBaseUrl = "http://localhost:3001";
const apiBaseUrl = "http://localhost:4000";

const openApps: ReturnType<typeof buildServer>[] = [];

afterEach(async () => {
  await Promise.all(openApps.splice(0).map((app) => app.close()));
});

function fakeAuth(): VendorAuth {
  return { api: { getSession: async () => null } } as unknown as VendorAuth;
}

function createRuntime(): VendorAuthRuntime {
  return {
    auth: fakeAuth(),
    db: {} as Database,
    authDb: {} as Database,
    vendorBaseUrl,
    stepUpMinutes: 5,
  };
}

function createApp(
  options: { readonly withVendorRuntime?: boolean } = {},
): ReturnType<typeof buildServer> {
  const server = buildServer({
    apiBaseUrl,
    ...(options.withVendorRuntime === true ? { vendorRuntime: createRuntime() } : {}),
  });
  openApps.push(server);
  return server;
}

describe("регистрация вендорских маршрутов", () => {
  it("без vendorRuntime не регистрирует /v1/vendor/*", async () => {
    const response = await createApp().inject({ method: "GET", url: "/v1/vendor/auth/me" });
    expect(response.statusCode).toBe(404);
  });

  it("с vendorRuntime отдает 401 без сессии", async () => {
    const response = await createApp({ withVendorRuntime: true }).inject({
      method: "GET",
      url: "/v1/vendor/auth/me",
    });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ error: { code: "vendor_unauthenticated" } });
  });

  it("отклоняет небезопасный запрос с чужим Origin", async () => {
    const response = await createApp({ withVendorRuntime: true }).inject({
      method: "POST",
      url: "/v1/vendor/users",
      headers: { origin: "https://evil.example" },
      payload: {},
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ error: { code: "vendor_origin_denied" } });
  });

  it("пропускает запрос без Origin до guard", async () => {
    const response = await createApp({ withVendorRuntime: true }).inject({
      method: "POST",
      url: "/v1/vendor/users",
      payload: {},
    });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ error: { code: "vendor_unauthenticated" } });
  });

  it("пропускает Origin вендорского кабинета и API до guard", async () => {
    const app = createApp({ withVendorRuntime: true });
    for (const origin of [vendorBaseUrl, apiBaseUrl]) {
      const response = await app.inject({
        method: "POST",
        url: "/v1/vendor/users",
        headers: { origin },
        payload: {},
      });
      expect(response.statusCode).toBe(401);
    }
  });

  it("не применяет Origin-guard к безопасным методам", async () => {
    const response = await createApp({ withVendorRuntime: true }).inject({
      method: "GET",
      url: "/v1/vendor/auth/me",
      headers: { origin: "https://evil.example" },
    });
    expect(response.statusCode).toBe(401);
  });
});
