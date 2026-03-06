import { describe, expect, it } from "vitest";
import { parseStartArgs, shouldSkipForGroupChat } from "./startArgs";

describe("parseStartArgs", () => {
  it("parses channel-only args in private chats", () => {
    const parsed = parseStartArgs({
      text: "/start -c sales",
      chatType: "private",
      botUsername: "giftbot",
    });

    expect(parsed).toEqual({
      mention: null,
      channel: "sales",
      filter: null,
      error: null,
      skipForGroupChat: false,
    });
  });

  it("parses filter and mention in any order", () => {
    const parsed = parseStartArgs({
      text: "/start -f backdrop:midnight blue,name:a @GiftBot -c sales",
      chatType: "supergroup",
      botUsername: "giftbot",
    });

    expect(parsed).toEqual({
      mention: "giftbot",
      channel: "sales",
      filter: "backdrop:midnight blue,name:a",
      error: null,
      skipForGroupChat: false,
    });
  });

  it("accepts the crafts channel", () => {
    const parsed = parseStartArgs({
      text: "/start -c crafts",
      chatType: "private",
      botUsername: "giftbot",
    });

    expect(parsed).toEqual({
      mention: null,
      channel: "crafts",
      filter: null,
      error: null,
      skipForGroupChat: false,
    });
  });

  it("skips group chats when mention is missing", () => {
    const parsed = parseStartArgs({
      text: "/start -c sales -f backdrop:midnight blue",
      chatType: "group",
      botUsername: "giftbot",
    });

    expect(shouldSkipForGroupChat(parsed)).toBe(true);
    expect(parsed.error).toBeNull();
  });

  it("skips group chats when mention targets another bot", () => {
    const parsed = parseStartArgs({
      text: "/start @otherbot -c sales",
      chatType: "group",
      botUsername: "giftbot",
    });

    expect(shouldSkipForGroupChat(parsed)).toBe(true);
    expect(parsed.error).toBeNull();
  });

  it("rejects unsupported channels", () => {
    const parsed = parseStartArgs({
      text: "/start -c alerts",
      chatType: "private",
      botUsername: "giftbot",
    });

    expect(parsed.error).toBe("Unsupported channel: alerts");
  });

  it("rejects missing channel values", () => {
    const parsed = parseStartArgs({
      text: "/start -c",
      chatType: "private",
      botUsername: "giftbot",
    });

    expect(parsed.error).toBe("Missing value for -c.");
  });

  it("rejects missing required channel option", () => {
    const parsed = parseStartArgs({
      text: "/start -f backdrop:midnight blue",
      chatType: "private",
      botUsername: "giftbot",
    });

    expect(parsed.error).toBe("Missing required -c option.");
  });

  it("rejects missing filter values", () => {
    const parsed = parseStartArgs({
      text: "/start -c sales -f",
      chatType: "private",
      botUsername: "giftbot",
    });

    expect(parsed.error).toBe("Missing value for -f.");
  });

  it("rejects unknown args", () => {
    const parsed = parseStartArgs({
      text: "/start unexpected -c sales",
      chatType: "private",
      botUsername: "giftbot",
    });

    expect(parsed.error).toBe("Unknown argument: unexpected");
  });
});
