import { describe, expect, it } from "vitest";

import type { VendorMe } from "./vendor-types";
import { parseVendorMe, vendorMeResultFromResponse } from "./vendor-types";

const validMe: VendorMe = {
  user: {
    id: "2f1c5b5e-6a4a-4f5b-9b5e-0a1b2c3d4e5f",
    email: "vendor@example.test",
    name: "Vendor",
    role: "superadmin",
    status: "active",
    twoFactorEnabled: true,
  },
  mfaEnrollmentRequired: false,
  sessionExpiresAt: "2026-11-16T18:00:00.000Z",
  stepUpUntil: null,
};

describe("vendorMeResultFromResponse", () => {
  it("200 с валидным телом возвращает ok", () => {
    expect(vendorMeResultFromResponse(200, validMe)).toEqual({ kind: "ok", me: validMe });
  });

  it("200 с невалидным телом возвращает error", () => {
    expect(vendorMeResultFromResponse(200, { user: {} })).toEqual({ kind: "error" });
  });

  it("401 возвращает unauthenticated", () => {
    expect(vendorMeResultFromResponse(401, { error: { code: "vendor_unauthenticated" } })).toEqual({
      kind: "unauthenticated",
    });
  });

  it("403 vendor_inactive возвращает inactive", () => {
    expect(vendorMeResultFromResponse(403, { error: { code: "vendor_inactive" } })).toEqual({
      kind: "inactive",
    });
  });

  it("403 vendor_role_denied возвращает error, а не inactive", () => {
    expect(vendorMeResultFromResponse(403, { error: { code: "vendor_role_denied" } })).toEqual({
      kind: "error",
    });
  });

  it.each([500, 502])("%i возвращает error", (status) => {
    expect(vendorMeResultFromResponse(status, { error: { code: "upstream_unavailable" } })).toEqual(
      { kind: "error" },
    );
  });
});

describe("parseVendorMe", () => {
  it("считает отсутствующий stepUpUntil равным null", () => {
    const { stepUpUntil: _omitted, ...withoutStepUp } = validMe;
    expect(parseVendorMe(withoutStepUp)).toEqual(validMe);
  });

  it("принимает stepUpUntil строкой", () => {
    expect(parseVendorMe({ ...validMe, stepUpUntil: "2026-11-16T10:25:00.000Z" })).toEqual({
      ...validMe,
      stepUpUntil: "2026-11-16T10:25:00.000Z",
    });
  });

  it("отклоняет невалидный stepUpUntil", () => {
    expect(parseVendorMe({ ...validMe, stepUpUntil: 42 })).toBeNull();
  });
});
