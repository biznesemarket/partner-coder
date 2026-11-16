import type { IncomingHttpHeaders } from "node:http";

import { describe, expect, it } from "vitest";

import type { Database } from "@partner-coder/db";

import type { VendorAuth } from "./config.js";
import { resolveVendorIdentity, type VendorAuthLogger, type VendorAuthRuntime } from "./runtime.js";

const userId = "11111111-1111-4111-8111-111111111111";
const sessionId = "22222222-2222-4222-8222-222222222222";
const sessionExpiresAt = new Date("2026-11-16T18:00:00Z");
const stepUpUntil = new Date("2026-11-16T10:25:00Z");
const headers: IncomingHttpHeaders = { cookie: "pc-vendor.session_token=token" };

interface SessionPayloadInput {
  readonly role?: string | null;
  readonly status?: string | null;
  readonly twoFactorEnabled?: boolean;
  readonly expiresAt?: Date | string | null;
  readonly stepUpUntil?: Date | string | null;
}

function sessionPayload(input: SessionPayloadInput = {}) {
  return {
    user: {
      id: userId,
      email: "ops@example.com",
      name: "Опс",
      role: "role" in input ? input.role : "superadmin",
      status: "status" in input ? input.status : "active",
      twoFactorEnabled: input.twoFactorEnabled ?? true,
    },
    session: {
      id: sessionId,
      expiresAt: "expiresAt" in input ? input.expiresAt : sessionExpiresAt,
      stepUpUntil: "stepUpUntil" in input ? input.stepUpUntil : stepUpUntil,
    },
  };
}

function fakeAuth(result: unknown, onCall?: (input: { headers: Headers }) => void): VendorAuth {
  return {
    api: {
      getSession: async (input: { headers: Headers }) => {
        onCall?.(input);
        return result;
      },
    },
  } as unknown as VendorAuth;
}

function createRuntime(auth: VendorAuth): VendorAuthRuntime {
  const db = {} as Database;
  return {
    auth,
    db,
    authDb: db,
    vendorBaseUrl: "http://localhost:3001",
    stepUpMinutes: 5,
  };
}

function createLogger(): {
  readonly warnings: Array<{ fields: Record<string, unknown>; message: string }>;
  readonly logger: VendorAuthLogger;
} {
  const warnings: Array<{ fields: Record<string, unknown>; message: string }> = [];
  return {
    warnings,
    logger: {
      warn(fields, message) {
        warnings.push({ fields, message });
      },
    },
  };
}

describe("resolveVendorIdentity", () => {
  it("возвращает identity с ролью, статусом и mfa-флагом", async () => {
    const identity = await resolveVendorIdentity(
      createRuntime(fakeAuth(sessionPayload())),
      headers,
    );

    expect(identity).toEqual({
      userId,
      email: "ops@example.com",
      name: "Опс",
      role: "superadmin",
      status: "active",
      twoFactorEnabled: true,
      sessionId,
      sessionExpiresAt,
      stepUpUntil,
    });
  });

  it("возвращает null без сессии", async () => {
    const identity = await resolveVendorIdentity(createRuntime(fakeAuth(null)), headers);

    expect(identity).toBeNull();
  });

  it.each(["suspended", "disabled"] as const)("%s возвращает inactive-identity", async (status) => {
    const identity = await resolveVendorIdentity(
      createRuntime(fakeAuth(sessionPayload({ role: "support", status }))),
      headers,
    );

    expect(identity).toMatchObject({ userId, role: "support", status });
  });

  it("сохраняет invited и выключенный TOTP", async () => {
    const identity = await resolveVendorIdentity(
      createRuntime(
        fakeAuth(sessionPayload({ role: "support", status: "invited", twoFactorEnabled: false })),
      ),
      headers,
    );

    expect(identity).toMatchObject({ status: "invited", twoFactorEnabled: false });
  });

  it("без step-up поля возвращает null", async () => {
    const identity = await resolveVendorIdentity(
      createRuntime(fakeAuth(sessionPayload({ stepUpUntil: null }))),
      headers,
    );

    expect(identity?.stepUpUntil).toBeNull();
  });

  it("нормализует ISO-строки дат", async () => {
    const identity = await resolveVendorIdentity(
      createRuntime(
        fakeAuth(
          sessionPayload({
            expiresAt: "2026-11-16T18:00:00.000Z",
            stepUpUntil: "2026-11-16T10:25:00.000Z",
          }),
        ),
      ),
      headers,
    );

    expect(identity?.sessionExpiresAt).toEqual(sessionExpiresAt);
    expect(identity?.stepUpUntil).toEqual(stepUpUntil);
  });

  it.each([null, undefined, "not-a-date"] as const)(
    "возвращает null для некорректного sessionExpiresAt (%s)",
    async (expiresAt) => {
      const { warnings, logger } = createLogger();
      const identity = await resolveVendorIdentity(
        createRuntime(fakeAuth(sessionPayload({ expiresAt }))),
        headers,
        logger,
      );

      expect(identity).toBeNull();
      expect(warnings[0]).toMatchObject({ message: "vendor_session_invalid_expiry" });
    },
  );

  it.each(["owner", null] as const)(
    "возвращает null для невалидной роли %s и пишет warning",
    async (role) => {
      const { warnings, logger } = createLogger();
      const identity = await resolveVendorIdentity(
        createRuntime(fakeAuth(sessionPayload({ role }))),
        headers,
        logger,
      );

      expect(identity).toBeNull();
      expect(warnings[0]).toMatchObject({
        message: "vendor_session_invalid_role",
        fields: { sessionId, role },
      });
    },
  );

  it.each(["deleted", null] as const)(
    "возвращает null для невалидного статуса %s и пишет warning",
    async (status) => {
      const { warnings, logger } = createLogger();
      const identity = await resolveVendorIdentity(
        createRuntime(fakeAuth(sessionPayload({ status }))),
        headers,
        logger,
      );

      expect(identity).toBeNull();
      expect(warnings[0]).toMatchObject({
        message: "vendor_session_invalid_status",
        fields: { sessionId, status },
      });
    },
  );

  it("передает node-заголовки в Better Auth", async () => {
    let received: Headers | undefined;
    const auth = fakeAuth(sessionPayload(), (input) => {
      received = input.headers;
    });

    await resolveVendorIdentity(createRuntime(auth), headers);

    expect(received?.get("cookie")).toBe(headers.cookie);
  });
});
