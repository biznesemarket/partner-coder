import { describe, expect, it } from "vitest";

import { guardAction } from "./guard";
import type { VendorMe } from "./vendor-types";

function meWith(overrides: Partial<VendorMe> = {}): VendorMe {
  return {
    user: {
      id: "2f1c5b5e-6a4a-4f5b-9b5e-0a1b2c3d4e5f",
      email: "vendor@example.test",
      name: "Vendor",
      role: "superadmin",
      status: "active",
      twoFactorEnabled: false,
    },
    mfaEnrollmentRequired: true,
    sessionExpiresAt: "2026-11-16T18:00:00.000Z",
    stepUpUntil: null,
    ...overrides,
  };
}

describe("guardAction", () => {
  it("ошибка API не превращается в login/logout", () => {
    expect(guardAction({ kind: "error" })).toBe("error");
    expect(guardAction({ kind: "unauthenticated" })).toBe("login");
    expect(guardAction({ kind: "inactive" })).toBe("inactive");
    expect(guardAction({ kind: "ok", me: meWith({ mfaEnrollmentRequired: true }) })).toBe("mfa");
    expect(guardAction({ kind: "ok", me: meWith({ mfaEnrollmentRequired: false }) })).toBe(
      "render",
    );
  });
});
