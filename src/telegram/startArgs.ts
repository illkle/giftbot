type StartArgsInput = {
  text?: string;
  chatType?: string;
  botUsername?: string;
};

type ParsedStartArgs = {
  mention: string | null;
  channel: string | null;
  filter: string | null;
  error: string | null;
  skipForGroupChat: boolean;
};

const SALES_CHANNEL = "sales";

function isGroupChat(chatType: string | undefined): boolean {
  return chatType === "group" || chatType === "supergroup";
}

function normalizeUsername(value: string | undefined | null): string | null {
  if (!value) {
    return null;
  }

  return value.replace(/^@/, "").toLowerCase();
}

function parseStartArgs({ text, chatType, botUsername }: StartArgsInput): ParsedStartArgs {
  const normalizedBotUsername = normalizeUsername(botUsername);
  const baseResult: ParsedStartArgs = {
    mention: null,
    channel: null,
    filter: null,
    error: null,
    skipForGroupChat: false,
  };

  if (!text?.trim()) {
    return { ...baseResult, error: "Missing /start command text." };
  }

  const trimmedText = text.trim();
  const splitTokens = trimmedText.split(/\s+/);
  const commandToken = splitTokens[0];
  const restTokens = splitTokens.slice(1);
  if (!commandToken || !commandToken.startsWith("/start")) {
    return { ...baseResult, error: "Command must start with /start." };
  }

  let mention: string | null = null;
  let channel: string | null = null;
  let filter: string | null = null;

  for (let index = 0; index < restTokens.length; index += 1) {
    const token = restTokens[index];
    if (!token) {
      continue;
    }

    if (token.startsWith("@")) {
      if (mention !== null) {
        return { ...baseResult, error: "Duplicate bot mention." };
      }

      const normalizedMention = normalizeUsername(token);
      if (!normalizedMention) {
        return { ...baseResult, error: "Bot mention is empty." };
      }

      mention = normalizedMention;
      continue;
    }

    if (token === "-c") {
      if (channel !== null) {
        return { ...baseResult, error: "Duplicate -c option." };
      }

      const value = restTokens[index + 1];
      if (!value || value.startsWith("@") || value === "-c" || value === "-f") {
        return { ...baseResult, error: "Missing value for -c." };
      }

      channel = value.toLowerCase();
      index += 1;
      continue;
    }

    if (token === "-f") {
      if (filter !== null) {
        return { ...baseResult, error: "Duplicate -f option." };
      }

      const filterTokens: string[] = [];
      let cursor = index + 1;
      while (cursor < restTokens.length) {
        const value = restTokens[cursor];
        if (!value) {
          cursor += 1;
          continue;
        }

        if (value.startsWith("@") || value === "-c" || value === "-f") {
          break;
        }

        filterTokens.push(value);
        cursor += 1;
      }

      if (filterTokens.length === 0) {
        return { ...baseResult, error: "Missing value for -f." };
      }

      filter = filterTokens.join(" ");
      index = cursor - 1;
      continue;
    }

    return { ...baseResult, error: `Unknown argument: ${token}` };
  }

  if (channel === null) {
    return { ...baseResult, mention, filter, error: "Missing required -c option." };
  }

  if (channel !== SALES_CHANNEL) {
    return { ...baseResult, mention, channel, filter, error: `Unsupported channel: ${channel}` };
  }

  const skipForGroupChat =
    isGroupChat(chatType) && (!normalizedBotUsername || mention !== normalizedBotUsername);

  return {
    mention,
    channel,
    filter,
    error: null,
    skipForGroupChat,
  };
}

function shouldSkipForGroupChat(parsedArgs: ParsedStartArgs): boolean {
  return parsedArgs.skipForGroupChat;
}

export { SALES_CHANNEL, parseStartArgs, shouldSkipForGroupChat };
export type { ParsedStartArgs, StartArgsInput };
