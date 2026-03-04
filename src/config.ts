type AppConfig = {
  telegramBotToken: string;
  defaultChatId?: string;
  cronTimezone: string;
  runJobsOnStartup: boolean;
  databasePath: string;
};

function getRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

function parseBoolean(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined) {
    return defaultValue;
  }

  const normalized = value.toLowerCase().trim();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

export function getConfig(): AppConfig {
  return {
    telegramBotToken: getRequiredEnv("TELEGRAM_BOT_TOKEN"),
    defaultChatId: process.env.TELEGRAM_CHAT_ID,
    cronTimezone: process.env.CRON_TIMEZONE ?? "UTC",
    runJobsOnStartup: parseBoolean(process.env.RUN_JOBS_ON_STARTUP, true),
    databasePath: process.env.DATABASE_PATH ?? "./data/giftbot.sqlite",
  };
}

export type { AppConfig };
