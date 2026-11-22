import { describe, expect, it } from "vitest";

import { createMetricsIpAllowlist } from "./metrics-ip-allowlist.js";

describe("createMetricsIpAllowlist", () => {
  it("пустой список разрешает все адреса", () => {
    const allow = createMetricsIpAllowlist([]);
    expect(allow("203.0.113.5")).toBe(true);
    expect(allow(null)).toBe(true);
  });

  it("проверяет IPv4 CIDR и отдельный адрес", () => {
    const allow = createMetricsIpAllowlist(["10.0.0.0/8", "127.0.0.1"]);
    expect(allow("10.1.2.3")).toBe(true);
    expect(allow("127.0.0.1")).toBe(true);
    expect(allow("203.0.113.5")).toBe(false);
    expect(allow("::1")).toBe(false);
  });

  it("проверяет IPv6 и mapped IPv4", () => {
    const allow = createMetricsIpAllowlist(["2001:db8::/32", "192.0.2.0/24"]);
    expect(allow("2001:db8::1")).toBe(true);
    expect(allow("::ffff:192.0.2.10")).toBe(true);
    expect(allow("2001:dead::1")).toBe(false);
  });

  it("отклоняет мусор и неверный префикс на старте", () => {
    expect(() => createMetricsIpAllowlist(["not-an-ip"])).toThrow(RangeError);
    expect(() => createMetricsIpAllowlist(["10.0.0.0/33"])).toThrow(RangeError);
    expect(() => createMetricsIpAllowlist(["2001:db8::/129"])).toThrow(RangeError);
  });
});
