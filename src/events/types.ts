type EventType = "external_api_change" | "external_api_error" | "info";

type BotEvent = {
  type: EventType;
  source: string;
  message: string;
  chatId?: string;
  metadata?: Record<string, string | number | boolean>;
};

export type { BotEvent, EventType };
