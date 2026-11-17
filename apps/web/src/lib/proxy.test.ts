import { describe, expect, it, vi } from "vitest";

import { proxyVendorRequest } from "./proxy";
import type { FetchLike } from "./proxy";

const options = {
  apiBaseUrl: "http://localhost:4000",
  targetPathPrefix: "/api/vendor-auth",
  logger: () => undefined,
};

const origin = "http://localhost:3001";

function createRequest(path = "/api/vendor-auth/sign-in/email", init?: RequestInit): Request {
  return new Request(`${origin}${path}`, init);
}

function jsonBody(response: Response): Promise<unknown> {
  return response.json();
}

describe("proxyVendorRequest", () => {
  it("сохраняет несколько Set-Cookie", async () => {
    const response = await proxyVendorRequest(createRequest(), ["sign-in", "email"], {
      ...options,
      fetchImpl: async () =>
        new Response("{}", {
          status: 200,
          headers: [
            ["set-cookie", "pc-vendor.session_token=a; Path=/; HttpOnly"],
            ["set-cookie", "pc-vendor-passkey=b; Path=/; HttpOnly"],
          ],
        }),
    });

    expect(response.headers.getSetCookie()).toHaveLength(2);
    expect(response.headers.getSetCookie()).toEqual([
      "pc-vendor.session_token=a; Path=/; HttpOnly",
      "pc-vendor-passkey=b; Path=/; HttpOnly",
    ]);
  });

  it("не пересылает host, referer и x-forwarded-*", async () => {
    let forwarded: Headers | undefined;
    const fetchImpl: FetchLike = async (_url, init) => {
      forwarded = new Headers(init.headers);
      return new Response("{}", { status: 200 });
    };

    await proxyVendorRequest(
      createRequest("/api/vendor-auth/sign-in/email", {
        method: "POST",
        headers: {
          origin,
          cookie: "pc-vendor.session_token=a",
          "content-type": "application/json",
          accept: "application/json",
          "user-agent": "vitest",
          "x-request-id": "request-1",
          "idempotency-key": "idem-1",
          host: "evil.example",
          referer: "http://evil.example",
          "x-forwarded-for": "203.0.113.7",
          "x-forwarded-host": "evil.example",
          connection: "keep-alive",
        },
        body: "{}",
      }),
      ["sign-in", "email"],
      { ...options, fetchImpl },
    );

    expect(forwarded).toBeDefined();
    const headers = forwarded as Headers;
    expect(headers.get("cookie")).toBe("pc-vendor.session_token=a");
    expect(headers.get("content-type")).toBe("application/json");
    expect(headers.get("accept")).toBe("application/json");
    expect(headers.get("origin")).toBe(origin);
    expect(headers.get("user-agent")).toBe("vitest");
    expect(headers.get("x-request-id")).toBe("request-1");
    expect(headers.get("idempotency-key")).toBe("idem-1");
    expect(headers.get("host")).toBeNull();
    expect(headers.get("referer")).toBeNull();
    expect(headers.get("x-forwarded-for")).toBeNull();
    expect(headers.get("x-forwarded-host")).toBeNull();
    expect(headers.get("connection")).toBeNull();
    expect(headers.get("content-length")).toBeNull();
  });

  it.each([["..", "x"], [".", "x"], ["", "x"], ["a/b"], ["a b"], []])(
    "отклоняет path traversal и пустой сегмент: %j",
    async (...segments) => {
      const fetchImpl = vi.fn<FetchLike>();

      const response = await proxyVendorRequest(createRequest(), segments, {
        ...options,
        fetchImpl,
      });

      expect(response.status).toBe(400);
      expect(fetchImpl).not.toHaveBeenCalled();
      await expect(jsonBody(response)).resolves.toMatchObject({
        error: { code: "invalid_path" },
      });
    },
  );

  it("ограничивает тело 64 KiB", async () => {
    const fetchImpl = vi.fn<FetchLike>();
    const body = "x".repeat(70_000);

    const response = await proxyVendorRequest(
      createRequest("/api/vendor-auth/sign-in/email", {
        method: "POST",
        headers: { origin, "content-length": String(body.length) },
        body,
      }),
      ["sign-in", "email"],
      { ...options, fetchImpl },
    );

    expect(response.status).toBe(413);
    expect(fetchImpl).not.toHaveBeenCalled();
    await expect(jsonBody(response)).resolves.toMatchObject({
      error: { code: "payload_too_large" },
    });
  });

  it("ограничивает потоковое тело без content-length во время чтения", async () => {
    const cancel = vi.fn();
    const chunk = new Uint8Array(16 * 1024);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let index = 0; index < 5; index += 1) {
          controller.enqueue(chunk);
        }
      },
      cancel,
    });
    const fetchImpl = vi.fn<FetchLike>();
    const init = {
      method: "POST",
      headers: { origin, "content-type": "application/octet-stream" },
      body: stream,
      duplex: "half",
    } as RequestInit & { duplex: "half" };
    const request = new Request(`${origin}/api/vendor-auth/sign-in/email`, init);

    expect(request.headers.get("content-length")).toBeNull();

    const response = await proxyVendorRequest(request, ["sign-in", "email"], {
      ...options,
      fetchImpl,
    });

    expect(response.status).toBe(413);
    expect(cancel).toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
    await expect(jsonBody(response)).resolves.toMatchObject({
      error: { code: "payload_too_large" },
    });
  });

  it("возвращает invalid_body при ошибке чтения тела", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(new Error("client aborted"));
      },
    });
    const init = {
      method: "POST",
      headers: { origin, "content-type": "application/octet-stream" },
      body: stream,
      duplex: "half",
    } as RequestInit & { duplex: "half" };
    const fetchImpl = vi.fn<FetchLike>();
    const request = new Request(`${origin}/api/vendor-auth/sign-in/email`, init);

    const response = await proxyVendorRequest(request, ["sign-in", "email"], {
      ...options,
      fetchImpl,
    });

    expect(response.status).toBe(400);
    expect(fetchImpl).not.toHaveBeenCalled();
    await expect(jsonBody(response)).resolves.toMatchObject({
      error: { code: "invalid_body" },
    });
  });

  it("пробрасывает 3xx/4xx ответы upstream без исключения", async () => {
    for (const status of [302, 400, 403]) {
      const response = await proxyVendorRequest(createRequest(), ["me"], {
        ...options,
        targetPathPrefix: "/v1/vendor",
        fetchImpl: async () => new Response("error", { status }),
      });

      expect(response.status).toBe(status);
      expect(await response.text()).toBe("error");
      expect(response.headers.get("cache-control")).toBe("no-store");
    }
  });

  it("ограничивает query string 8 KiB", async () => {
    const fetchImpl = vi.fn<FetchLike>();
    const query = `?q=${"x".repeat(8 * 1024)}`;

    const response = await proxyVendorRequest(
      createRequest(`/api/vendor-auth/sign-in/email${query}`),
      ["sign-in", "email"],
      { ...options, fetchImpl },
    );

    expect(response.status).toBe(414);
    expect(fetchImpl).not.toHaveBeenCalled();
    await expect(jsonBody(response)).resolves.toMatchObject({
      error: { code: "query_too_long" },
    });
  });

  it("отклоняет чужой Origin для POST", async () => {
    const fetchImpl = vi.fn<FetchLike>();

    const response = await proxyVendorRequest(
      createRequest("/api/vendor-auth/sign-in/email", {
        method: "POST",
        headers: { origin: "http://evil.example" },
        body: "{}",
      }),
      ["sign-in", "email"],
      { ...options, fetchImpl },
    );

    expect(response.status).toBe(403);
    expect(fetchImpl).not.toHaveBeenCalled();
    await expect(jsonBody(response)).resolves.toMatchObject({
      error: { code: "origin_forbidden" },
    });
  });

  it("принимает собственный Origin и опцию expectedOrigin", async () => {
    const fetchImpl: FetchLike = async () => new Response("{}", { status: 200 });

    const sameOrigin = await proxyVendorRequest(
      createRequest("/api/vendor-auth/sign-in/email", {
        method: "POST",
        headers: { origin },
        body: "{}",
      }),
      ["sign-in", "email"],
      { ...options, fetchImpl, expectedOrigin: origin },
    );

    expect(sameOrigin.status).toBe(200);
  });

  it("возвращает 502 при недоступном API", async () => {
    const response = await proxyVendorRequest(createRequest(), ["sign-in", "email"], {
      ...options,
      fetchImpl: async () => {
        throw new Error("connection refused");
      },
    });

    expect(response.status).toBe(502);
    expect(response.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
    await expect(jsonBody(response)).resolves.toMatchObject({
      error: { code: "upstream_unavailable" },
    });
  });

  it("собирает target, пробрасывает query и генерирует x-request-id", async () => {
    let target: string | undefined;
    let forwarded: Headers | undefined;
    const fetchImpl: FetchLike = async (url, init) => {
      target = url;
      forwarded = new Headers(init.headers);
      return new Response("{}", { status: 200 });
    };

    const response = await proxyVendorRequest(
      createRequest("/api/vendor-auth/sign-in/email?a=1&b=%20"),
      ["sign-in", "email"],
      { ...options, fetchImpl },
    );

    expect(target).toBe("http://localhost:4000/api/vendor-auth/sign-in/email?a=1&b=%20");
    const requestId = (forwarded as Headers).get("x-request-id");
    expect(requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(response.headers.get("x-request-id")).toBe(requestId);
  });

  it("логирует одну безопасную строку без query, cookie и body", async () => {
    const lines: string[] = [];
    const fetchImpl: FetchLike = async () => new Response("{}", { status: 200 });

    const response = await proxyVendorRequest(
      createRequest("/api/vendor-auth/sign-in/email?token=QuerySecret", {
        method: "POST",
        headers: {
          origin,
          cookie: "pc-vendor.session_token=CookieSecret",
          "content-type": "application/json",
          "x-request-id": "req_1.ok-2",
        },
        body: JSON.stringify({ password: "BodySecret" }),
      }),
      ["sign-in", "email"],
      { ...options, fetchImpl, logger: (line) => lines.push(line) },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("x-request-id")).toBe("req_1.ok-2");
    expect(lines).toHaveLength(1);

    const line = lines[0] ?? "";
    expect(line).toContain("method=POST");
    expect(line).toContain("path=/api/vendor-auth/sign-in/email");
    expect(line).toContain("status=200");
    expect(line).toContain("requestId=req_1.ok-2");
    expect(line).toMatch(/durationMs=\d+/);
    expect(line).not.toContain("QuerySecret");
    expect(line).not.toContain("CookieSecret");
    expect(line).not.toContain("BodySecret");
    expect(line).not.toContain("token=");
  });

  it.each([
    ["пробелы", "bad id with spaces"],
    ["слишком длинный", "a".repeat(129)],
    ["пустой", ""],
  ])("заменяет невалидный x-request-id на UUID (%s)", async (_name, value) => {
    const lines: string[] = [];
    let forwardedId: string | null = null;
    const fetchImpl: FetchLike = async (_url, init) => {
      forwardedId = new Headers(init.headers).get("x-request-id");
      return new Response("{}", { status: 200 });
    };

    const response = await proxyVendorRequest(
      createRequest("/api/vendor-auth/me", { headers: { "x-request-id": value } }),
      ["me"],
      { ...options, fetchImpl, logger: (line) => lines.push(line) },
    );

    expect(forwardedId).toMatch(/^[0-9a-f-]{36}$/);
    expect(response.headers.get("x-request-id")).toBe(forwardedId);
    expect(lines[0] ?? "").toContain(`requestId=${forwardedId ?? ""}`);
  });

  it("логирует отклонённый запрос без query-строки", async () => {
    const lines: string[] = [];

    const response = await proxyVendorRequest(
      createRequest("/api/vendor-auth/x?secret=QuerySecret"),
      [".."],
      { ...options, logger: (line) => lines.push(line) },
    );

    expect(response.status).toBe(400);
    expect(lines).toHaveLength(1);
    expect(lines[0] ?? "").toContain("status=400");
    expect(lines[0] ?? "").toContain("path=/api/vendor-auth/x");
    expect(lines[0] ?? "").not.toContain("QuerySecret");
    expect(lines[0] ?? "").not.toContain("secret=");
  });

  it("копирует только разрешённые заголовки ответа и ставит no-store", async () => {
    const response = await proxyVendorRequest(createRequest(), ["me"], {
      ...options,
      targetPathPrefix: "/v1/vendor",
      fetchImpl: async () =>
        new Response("ok", {
          status: 200,
          headers: {
            "content-type": "application/json",
            "content-disposition": "attachment; filename=me.json",
            "content-encoding": "gzip",
            "content-length": "123",
            "x-request-id": "upstream-1",
            "cache-control": "public, max-age=60",
          },
        }),
    });

    expect(response.headers.get("content-type")).toBe("application/json");
    expect(response.headers.get("content-disposition")).toBe("attachment; filename=me.json");
    expect(response.headers.get("content-encoding")).toBeNull();
    expect(response.headers.get("content-length")).toBeNull();
    expect(response.headers.get("x-request-id")).toBe("upstream-1");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});
