import { afterEach, describe, expect, it } from "vitest";

import type { Database } from "@partner-coder/db";

import { EmailRateLimiter, type EmailRateLimitStore } from "../auth/email-rate-limit.js";
import { buildServer } from "../server.js";
import type { VendorAuth } from "./config.js";
import type { VendorAuthRuntime } from "./runtime.js";

const vendorBaseUrl = "http://localhost:3001";
const apiBaseUrl = "http://localhost:4000";
const email = "ops@example.com";
const password = "correct horse battery staple";

interface CapturedRequest {
  readonly url: string;
  readonly method: string;
  readonly body: string;
}

interface TestApp {
  readonly app: ReturnType<typeof buildServer>;
  readonly requests: CapturedRequest[];
}

const openApps: ReturnType<typeof buildServer>[] = [];

afterEach(async () => {
  await Promise.all(openApps.splice(0).map((app) => app.close()));
});

function createAuth(requests: CapturedRequest[]): VendorAuth {
  return {
    async handler(request: Request): Promise<Response> {
      requests.push({
        url: request.url,
        method: request.method,
        body: await request.clone().text(),
      });
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: [
          ["content-type", "application/json"],
          ["set-cookie", "pc-vendor.session_token=token; Path=/; HttpOnly"],
        ],
      });
    },
  } as unknown as VendorAuth;
}

function createRuntime(auth: VendorAuth): VendorAuthRuntime {
  return {
    auth,
    db: {} as Database,
    authDb: {} as Database,
    vendorBaseUrl,
    stepUpMinutes: 5,
  };
}

function createApp(
  options: { apiBaseUrl?: string; rateLimitStore?: EmailRateLimitStore } = {},
): TestApp {
  const requests: CapturedRequest[] = [];
  const app = buildServer({
    vendorRuntime: createRuntime(createAuth(requests)),
    apiBaseUrl: options.apiBaseUrl ?? apiBaseUrl,
    ...(options.rateLimitStore === undefined
      ? {}
      : { vendorEmailRateLimitStore: options.rateLimitStore }),
  });
  openApps.push(app);
  return { app, requests };
}

function rejectingStore(keys: string[]): EmailRateLimitStore {
  return {
    consume(value) {
      keys.push(value);
      return false;
    },
  };
}

function signIn(app: TestApp["app"], value: string) {
  return app.inject({
    method: "POST",
    url: "/api/vendor-auth/sign-in/email",
    payload: { email: value, password },
  });
}

describe("vendor auth proxy", () => {
  it.each([
    ["POST", "/sign-up"],
    ["POST", "/sign-up/email"],
    ["POST", "/sign-up/email?redirect=/x"],
    ["POST", "/two-factor/disable"],
    ["POST", "/two-factor/send-otp"],
    ["POST", "/two-factor/verify-otp"],
    ["GET", "/admin/users"],
    ["POST", "/delete-user"],
    ["POST", "/change-email"],
    ["POST", "/link-social"],
    ["POST", "/unlink-account"],
    ["POST", "/sign-in/social"],
    ["GET", "/callback/google"],
    ["POST", "//sign-up/email"],
    ["POST", "/%73ign-up/email"],
  ] as const)("блокирует %s %s", async (method, path) => {
    const { app, requests } = createApp();
    const response = await app.inject({ method, url: `/api/vendor-auth${path}` });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ error: { code: "vendor_auth_path_forbidden" } });
    expect(requests).toHaveLength(0);
  });

  it("пробрасывает разрешенный sign-in, тело и set-cookie", async () => {
    const { app, requests } = createApp();
    const response = await signIn(app, email);

    expect(response.statusCode).toBe(200);
    expect(response.headers["set-cookie"]).toEqual([
      expect.stringContaining("pc-vendor.session_token=token"),
    ]);
    expect(response.json()).toMatchObject({ ok: true });
    expect(requests).toHaveLength(1);
    const captured = requests.at(0);
    expect(captured?.method).toBe("POST");
    expect(new URL(captured?.url ?? "").pathname).toBe("/api/vendor-auth/sign-in/email");
    expect(JSON.parse(captured?.body ?? "")).toEqual({ email, password });
  });

  it("применяет per-email лимит 5/60 к sign-in с нормализованным email", async () => {
    const inner = new EmailRateLimiter();
    const keys: string[] = [];
    const store: EmailRateLimitStore = {
      consume(value) {
        keys.push(value);
        return inner.consume(value);
      },
    };
    const { app } = createApp({ rateLimitStore: store });

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await signIn(app, attempt % 2 === 0 ? `  ${email.toUpperCase()}  ` : email);
      expect(response.statusCode).toBe(200);
    }

    const limited = await signIn(app, ` ${email.toUpperCase()} `);
    expect(limited.statusCode).toBe(429);
    expect(limited.json()).toMatchObject({ error: { code: "email_rate_limited" } });
    expect(keys.every((key) => key === email)).toBe(true);

    const other = await signIn(app, "support@example.com");
    expect(other.statusCode).toBe(200);
  });

  it("лимитирует request-password-reset по email", async () => {
    const { app } = createApp();
    const reset = () =>
      app.inject({
        method: "POST",
        url: "/api/vendor-auth/request-password-reset",
        payload: { email },
      });

    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect((await reset()).statusCode).toBe(200);
    }
    const limited = await reset();
    expect(limited.statusCode).toBe(429);
    expect(limited.json()).toMatchObject({ error: { code: "email_rate_limited" } });
  });

  it("не расходует лимит на путях вне списка", async () => {
    const keys: string[] = [];
    const { app } = createApp({ rateLimitStore: rejectingStore(keys) });
    const response = await app.inject({
      method: "POST",
      url: "/api/vendor-auth/two-factor/verify-totp",
      payload: { email },
    });

    expect(response.statusCode).toBe(200);
    expect(keys).toHaveLength(0);
  });

  it("не расходует лимит без строкового email", async () => {
    const keys: string[] = [];
    const { app } = createApp({ rateLimitStore: rejectingStore(keys) });
    const response = await app.inject({
      method: "POST",
      url: "/api/vendor-auth/sign-in/email",
      payload: { email: 123, password },
    });

    expect(response.statusCode).toBe(200);
    expect(keys).toHaveLength(0);
  });

  it("не пропускает чужой Origin на мутациях", async () => {
    const { app, requests } = createApp();
    const response = await app.inject({
      method: "POST",
      url: "/api/vendor-auth/sign-in/email",
      headers: { origin: "https://evil.example" },
      payload: { email, password },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ error: { code: "vendor_origin_denied" } });
    expect(requests).toHaveLength(0);
  });

  it("разрешает Origin консоли, API и запросы без Origin", async () => {
    const { app } = createApp();
    for (const origin of [vendorBaseUrl, `${apiBaseUrl}/`, undefined]) {
      const response = await app.inject({
        method: "POST",
        url: "/api/vendor-auth/sign-in/email",
        ...(origin === undefined ? {} : { headers: { origin } }),
        payload: { email, password },
      });
      expect(response.statusCode).toBe(200);
    }
  });

  it("проверяет Origin по переданному apiBaseUrl", async () => {
    const wiredApiBaseUrl = "https://api.example.test";
    const { app, requests } = createApp({ apiBaseUrl: wiredApiBaseUrl });

    const allowed = await app.inject({
      method: "POST",
      url: "/api/vendor-auth/sign-in/email",
      headers: { origin: wiredApiBaseUrl },
      payload: { email, password },
    });
    expect(allowed.statusCode).toBe(200);

    for (const origin of [apiBaseUrl, "https://api.example.test.evil"]) {
      const denied = await app.inject({
        method: "POST",
        url: "/api/vendor-auth/request-password-reset",
        headers: { origin },
        payload: { email },
      });
      expect(denied.statusCode).toBe(403);
      expect(denied.json()).toMatchObject({ error: { code: "vendor_origin_denied" } });
    }
    expect(requests).toHaveLength(1);
  });

  it("не проверяет Origin на безопасных методах", async () => {
    const { app } = createApp();
    const response = await app.inject({
      method: "GET",
      url: "/api/vendor-auth/get-session",
      headers: { origin: "https://evil.example" },
    });

    expect(response.statusCode).toBe(200);
  });

  it("требует apiBaseUrl при наличии vendor runtime", () => {
    const runtime = createRuntime(createAuth([]));

    expect(() => buildServer({ vendorRuntime: runtime })).toThrow(/apiBaseUrl/);
  });

  it("без vendor runtime отдает 404", async () => {
    const app = buildServer();
    openApps.push(app);
    const response = await app.inject({
      method: "POST",
      url: "/api/vendor-auth/sign-in/email",
      payload: { email, password },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: { code: "not_found" } });
  });
});
