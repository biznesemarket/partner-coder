import { describe, expect, it } from "vitest";

import { passkeyLabel } from "./passkeys";

describe("passkeyLabel", () => {
  it("берёт имя, затем AAGUID, затем Passkey", () => {
    expect(passkeyLabel({ name: "Ноутбук", aaguid: null })).toBe("Ноутбук");
    expect(passkeyLabel({ name: null, aaguid: "00000000-0000-0000-0000-000000000000" })).toBe(
      "Passkey",
    );
  });

  it("подставляет известное имя по AAGUID", () => {
    expect(passkeyLabel({ name: "  ", aaguid: "08987058-cadc-4b81-b6e1-30de50dcbe96" })).toBe(
      "Windows Hello",
    );
  });
});
