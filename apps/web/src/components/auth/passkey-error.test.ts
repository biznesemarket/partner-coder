import { describe, expect, it } from "vitest";

import { isPasskeyCancellation } from "./passkey-error";

describe("isPasskeyCancellation", () => {
  it.each([
    "AUTH_CANCELLED",
    "REGISTRATION_CANCELLED",
    "ERROR_CEREMONY_ABORTED",
    "ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY",
  ])("подавляет код %s", (code) => {
    expect(isPasskeyCancellation({ code, message: "cancelled", status: 400 })).toBe(true);
  });

  it("подавляет браузерные имена отмены", () => {
    expect(isPasskeyCancellation({ name: "NotAllowedError" })).toBe(true);
    expect(isPasskeyCancellation({ name: "AbortError" })).toBe(true);
    expect(isPasskeyCancellation({ name: "Error", cause: { name: "NotAllowedError" } })).toBe(true);
    expect(isPasskeyCancellation({ name: "Error", cause: { name: "AbortError" } })).toBe(true);
  });

  it("не подавляет прочие ошибки", () => {
    expect(isPasskeyCancellation({ code: "SESSION_EXPIRED", status: 401 })).toBe(false);
    expect(isPasskeyCancellation({ message: "cancelled" })).toBe(false);
    expect(isPasskeyCancellation({ code: null })).toBe(false);
    expect(isPasskeyCancellation(null)).toBe(false);
    expect(isPasskeyCancellation(undefined)).toBe(false);
    expect(isPasskeyCancellation("AUTH_CANCELLED")).toBe(false);
  });
});
