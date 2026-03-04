import { describe, expect, it } from "vitest";
import {
  matchesGiftFilterConfig,
  parseGiftFilterConfig,
  stringifyGiftFilterConfig,
} from "./giftFilterConfig";

describe("parseGiftFilterConfig", () => {
  it("parses comma-separated field:value conditions", () => {
    const result = parseGiftFilterConfig(" Backdrop: LemonGrass , symbol:Shield ");

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.config.conditions).toEqual([
      { field: "backdrop", value: "lemongrass" },
      { field: "symbol", value: "shield" },
    ]);
    expect(stringifyGiftFilterConfig(result.config)).toBe("backdrop:lemongrass,symbol:shield");
  });

  it("rejects pipe syntax and asks for comma-separated conditions", () => {
    const result = parseGiftFilterConfig("backdrop:lemongrass|orange");

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }

    expect(result.error).toContain("Use commas between conditions");
  });
});

describe("matchesGiftFilterConfig", () => {
  it("matches by case-insensitive substring on field and value", () => {
    const parsed = parseGiftFilterConfig("backdrop:lemon,symbol:shield");
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }

    expect(
      matchesGiftFilterConfig(parsed.config, {
        Backdrop: "LemonGrass Glow",
        Symbol: "Star",
      }),
    ).toBe(true);
  });

  it("uses OR semantics across comma-separated conditions", () => {
    const parsed = parseGiftFilterConfig("backdrop:orange,symbol:shield");
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }

    expect(
      matchesGiftFilterConfig(parsed.config, {
        Backdrop: "Blue Sky",
        Symbol: "Shield of Light",
      }),
    ).toBe(true);
  });

  it("returns false when none of conditions match", () => {
    const parsed = parseGiftFilterConfig("backdrop:orange,symbol:shield");
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }

    expect(
      matchesGiftFilterConfig(parsed.config, {
        Backdrop: "Blue Sky",
        Symbol: "Spear",
      }),
    ).toBe(false);
  });
});
