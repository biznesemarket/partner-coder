import { describe, expect, it } from "vitest";

import { redactUrl } from "./logger.js";

describe("редакция URL в логах", () => {
  it("скрывает токены в query", () => {
    expect(redactUrl("/api/auth/magic-link/verify?token=secret&email=a@b.c")).toBe(
      "/api/auth/magic-link/verify?token=%5Bredacted%5D&email=a%40b.c",
    );
  });

  it("скрывает токены приглашений в пути", () => {
    expect(redactUrl("/v1/public/invitations/abcdef123456")).toBe(
      "/v1/public/invitations/[redacted]",
    );
    expect(redactUrl("/v1/auth/invitations/abcdef123456/accept")).toBe(
      "/v1/auth/invitations/[redacted]/accept",
    );
  });

  it("оставляет обычные пути без изменений", () => {
    expect(redactUrl("/v1/tenant/overview?limit=10")).toBe("/v1/tenant/overview?limit=10");
  });
});
