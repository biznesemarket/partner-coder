import { describe, expect, it } from "vitest";

import { cn } from "./cn";

describe("cn", () => {
  it("объединяет классы и убирает конфликты tailwind", () => {
    const hidden: boolean = false;

    expect(cn("px-2", hidden && "hidden", ["py-1", { "px-4": true }])).toBe("py-1 px-4");
  });
});
