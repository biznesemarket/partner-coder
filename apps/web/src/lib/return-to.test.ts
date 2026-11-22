import { describe, expect, it } from "vitest";

import { sanitizeReturnTo } from "./return-to";

describe("sanitizeReturnTo", () => {
  it.each([
    ["/me/security", "/me/security"],
    ["//evil.example", "/me"],
    ["https://evil.example", "/me"],
    ["\\\\evil.example", "/me"],
    ["/me?token=secret", "/me"],
    ["/login", "/me"],
    ["/login/", "/me"],
    ["/reset-password", "/me"],
    ["/setup-mfa", "/me"],
    [undefined, "/me"],
  ])("sanitizeReturnTo(%s) -> %s", (input, expected) => {
    expect(sanitizeReturnTo(input)).toBe(expected);
  });

  it("возвращает /me для пустой строки и null", () => {
    expect(sanitizeReturnTo("")).toBe("/me");
    expect(sanitizeReturnTo(null)).toBe("/me");
  });
});
