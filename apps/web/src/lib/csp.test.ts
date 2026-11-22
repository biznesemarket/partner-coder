import { describe, expect, it } from "vitest";

import { buildContentSecurityPolicy } from "./csp";

const nonce = "0f8fad5b-d9cb-469f-a165-70867728950e";

describe("buildContentSecurityPolicy", () => {
  it("использует nonce и strict-dynamic для скриптов", () => {
    const policy = buildContentSecurityPolicy({ nonce, isDev: false });

    expect(policy).toContain("default-src 'self'");
    expect(policy).toContain(`script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`);
    expect(policy).not.toContain("'unsafe-eval'");
  });

  it("разрешает eval и websocket только в development", () => {
    const devPolicy = buildContentSecurityPolicy({ nonce, isDev: true });
    const prodPolicy = buildContentSecurityPolicy({ nonce, isDev: false });

    expect(devPolicy).toContain("'unsafe-eval'");
    expect(devPolicy).toContain("connect-src 'self' ws: wss:");
    expect(devPolicy).not.toContain("upgrade-insecure-requests");

    expect(prodPolicy).toContain("connect-src 'self'");
    expect(prodPolicy).toContain("upgrade-insecure-requests");
  });

  it("закрывает object, base, form и frame", () => {
    const policy = buildContentSecurityPolicy({ nonce, isDev: false });

    expect(policy).toContain("object-src 'none'");
    expect(policy).toContain("base-uri 'self'");
    expect(policy).toContain("form-action 'self'");
    expect(policy).toContain("frame-ancestors 'none'");
  });

  it("разрешает inline-стили для Radix и Tailwind", () => {
    const policy = buildContentSecurityPolicy({ nonce, isDev: false });

    expect(policy).toContain("style-src 'self' 'unsafe-inline'");
    expect(policy).not.toContain("style-src 'none'");
  });
});
