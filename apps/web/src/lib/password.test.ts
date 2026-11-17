import { describe, expect, it } from "vitest";

import { passwordError, passwordsMatchError } from "./password";

describe("passwordError", () => {
  it("требует минимум 12 символов", () => {
    expect(passwordError("short", 12)).toMatch(/12/);
    expect(passwordError("correct horse battery", 12)).toBeNull();
  });

  it("считает любой лимит включительно", () => {
    expect(passwordError("12345678901", 12)).toMatch(/12/);
    expect(passwordError("123456789012", 12)).toBeNull();
    expect(passwordError("", 12)).toMatch(/12/);
  });
});

describe("passwordsMatchError", () => {
  it("требует совпадения паролей", () => {
    expect(passwordsMatchError("a", "b")).toMatch(/не совпадают/);
    expect(passwordsMatchError("a", "a")).toBeNull();
  });

  it("различает регистр", () => {
    expect(passwordsMatchError("Secret123456", "secret123456")).toMatch(/не совпадают/);
  });
});
