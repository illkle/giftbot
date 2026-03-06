type EventType = "external_api_change" | "error" | "info";

type BotEvent = {
  type: EventType;
  source: string;
  message: string;
  chatId?: string;
  topicId?: number;
  metadata?: Record<string, string | number | boolean>;
  html?: boolean;
};

export type { BotEvent, EventType };
