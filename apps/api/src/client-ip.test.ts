import { signClientIp } from "@partner-coder/domain";
import { describe, expect, it } from "vitest";

import { verifyTrustedClientIp } from "./client-ip.js";

const secret = "unit-test-trusted-client-ip-secret-32-bytes";

describe("verifyTrustedClientIp", () => {
  it("принимает только подпись того же IP", () => {
    const ip = "203.0.113.5";
    expect(verifyTrustedClientIp(ip, signClientIp(secret, ip), secret)).toBe(ip);
    expect(verifyTrustedClientIp(ip, signClientIp(secret, "203.0.113.6"), secret)).toBeNull();
    expect(verifyTrustedClientIp(ip, "0".repeat(64), secret)).toBeNull();
  });

  it("игнорирует отсутствующие и нестроковые заголовки", () => {
    expect(verifyTrustedClientIp(undefined, undefined, secret)).toBeNull();
    expect(
      verifyTrustedClientIp(["203.0.113.5"], signClientIp(secret, "203.0.113.5"), secret),
    ).toBeNull();
    expect(verifyTrustedClientIp("203.0.113.5", undefined, secret)).toBeNull();
  });
});
