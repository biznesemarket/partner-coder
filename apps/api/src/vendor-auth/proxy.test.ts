import { describe, expect, it } from "vitest";

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

function createApp(options: { rateLimitStore?: EmailRateLimitStore } = {}): TestApp {
  const requests: CapturedRequest[] = [];
  const auth = {
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

  const runtime: VendorAuthRuntime = {
    auth,
    db: {} as Database,
    authDb: {} as Database,
    vendorBaseUrl,
    stepUpMinutes: 5,
  };

  const app = buildServer({
    vendorRuntime: runtime,
    ...(options.rateLimitStore === undefined
      ? {}
      : { vendorEmailRateLimitStore: options.rateLimitStore }),
  });

  return { app, requests };
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
    await app.close();
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
    await app.close();
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
    await app.close();
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
    await app.close();
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
    await app.close();
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
    await app.close();
  });

  it("не проверяет Origin на безопасных методах", async () => {
    const { app } = createApp();
    const response = await app.inject({
      method: "GET",
      url: "/api/vendor-auth/get-session",
      headers: { origin: "https://evil.example" },
    });

    expect(response.statusCode).toBe(200);
    await app.close();
  });

  it("без vendor runtime отдает 404", async () => {
    const app = buildServer();
    const response = await app.inject({
      method: "POST",
      url: "/api/vendor-auth/sign-in/email",
      payload: { email, password },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: { code: "not_found" } });
    await app.close();
  });
});
