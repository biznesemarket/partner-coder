import { describe, expect, it } from "vitest";

import { MemoryMailer } from "./mailer.js";

describe("MemoryMailer", () => {
  it("MemoryMailer запоминает письмо сброса пароля вендора", async () => {
    const mailer = new MemoryMailer();
    await mailer.sendVendorPasswordReset({
      email: "ops@example.com",
      url: "https://x/reset?token=t",
      ttlMinutes: 45,
    });
    expect(mailer.vendorPasswordResets).toEqual([
      { email: "ops@example.com", url: "https://x/reset?token=t", ttlMinutes: 45 },
    ]);
  });
});
