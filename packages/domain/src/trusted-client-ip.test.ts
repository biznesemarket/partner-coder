import { describe, expect, it } from "vitest";

import { normalizeClientIp, signClientIp, verifyClientIpSignature } from "./trusted-client-ip.js";

const secret = "unit-test-trusted-client-ip-secret-32-bytes";

describe("trusted client IP", () => {
  it("берёт первый IP из X-Forwarded-For и поддерживает порт/скобки", () => {
    expect(normalizeClientIp("203.0.113.5, 10.0.0.1")).toBe("203.0.113.5");
    expect(normalizeClientIp("2001:db8::1")).toBe("2001:db8::1");
    expect(normalizeClientIp("[2001:db8::1]:443")).toBe("2001:db8::1");
    expect(normalizeClientIp("203.0.113.5:1234")).toBe("203.0.113.5");
    expect(normalizeClientIp("unknown")).toBeNull();
    expect(normalizeClientIp("")).toBeNull();
    expect(normalizeClientIp(null)).toBeNull();
  });

  it("проверяет подпись только для того же IP и секрета", () => {
    const ip = "203.0.113.5";
    const signature = signClientIp(secret, ip);

    expect(verifyClientIpSignature(secret, ip, signature)).toBe(true);
    expect(verifyClientIpSignature(`${secret}-other`, ip, signature)).toBe(false);
    expect(verifyClientIpSignature(secret, "203.0.113.6", signature)).toBe(false);
    expect(verifyClientIpSignature(secret, ip, "0".repeat(64))).toBe(false);
    expect(verifyClientIpSignature(secret, ip, "not-hex")).toBe(false);
  });

  it("не подписывает невалидный IP", () => {
    expect(() => signClientIp(secret, "not-an-ip")).toThrow(RangeError);
    expect(() => signClientIp(secret, "")).toThrow(RangeError);
  });
});
