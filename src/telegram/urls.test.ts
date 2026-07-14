import { describe, expect, it } from "vitest";
import { normalizeTelegramBaseUrl, rebaseTelegramUrl } from "./urls";

describe("Telegram URLs", () => {
  it("defaults to t.me and accepts telegram.me", () => {
    expect(normalizeTelegramBaseUrl(undefined)).toBe("https://t.me");
    expect(normalizeTelegramBaseUrl("https://telegram.me/")).toBe("https://telegram.me");
  });

  it("rejects unsupported base URLs", () => {
    expect(() => normalizeTelegramBaseUrl("https://example.com")).toThrow(
      "TELEGRAM_BASE_URL must be either https://t.me or https://telegram.me",
    );
  });

  it("moves a Telegram URL to the selected base without changing its path or query", () => {
    expect(rebaseTelegramUrl("https://t.me/mrkt/app?startapp=123", "https://telegram.me")).toBe(
      "https://telegram.me/mrkt/app?startapp=123",
    );
  });
});
