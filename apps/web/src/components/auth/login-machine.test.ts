import { describe, expect, it } from "vitest";

import { afterPassword, afterSecondFactor } from "./login-machine";

describe("afterPassword", () => {
  it("переводит в TOTP при twoFactorRedirect", () => {
    expect(afterPassword({ twoFactorRedirect: true }, "/me/security")).toEqual({
      kind: "totp",
      returnTo: "/me/security",
      useBackupCode: false,
    });
  });

  it("без twoFactorRedirect просит проверить MFA-статус", () => {
    expect(afterPassword({ twoFactorRedirect: false }, "/me")).toEqual({
      kind: "resolve",
      returnTo: "/me",
    });
    expect(afterPassword(null, "/me")).toEqual({ kind: "resolve", returnTo: "/me" });
  });
});

describe("afterSecondFactor", () => {
  it("после второго фактора отправляет на enroll или done", () => {
    expect(afterSecondFactor("/me", true)).toEqual({ kind: "enroll", returnTo: "/me" });
    expect(afterSecondFactor("/me", false)).toEqual({ kind: "done", returnTo: "/me" });
  });
});
