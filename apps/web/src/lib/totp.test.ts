import { describe, expect, it } from "vitest";

import { parseTotpUri } from "./totp";

describe("parseTotpUri", () => {
  it("извлекает secret и issuer из otpauth URI", () => {
    expect(
      parseTotpUri(
        "otpauth://totp/Партнер%20кодер:ops%40example.com?secret=ABC234&issuer=%D0%9F%D0%B0%D1%80%D1%82%D0%BD%D0%B5%D1%80",
      ),
    ).toEqual({ secret: "ABC234", issuer: "Партнер", account: "ops@example.com" });
  });

  it("не бросает исключение на некорректном URI", () => {
    expect(parseTotpUri("not a uri")).toEqual({ secret: "", issuer: null, account: null });
    expect(parseTotpUri("")).toEqual({ secret: "", issuer: null, account: null });
  });
});
