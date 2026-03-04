import { Bot } from "grammy";

function createTelegramBot(token: string): Bot {
  return new Bot(token);
}

export { createTelegramBot };
