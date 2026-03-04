# giftbot

Telegram bot with a pluggable cron watcher layer:

1. Cron jobs run on a schedule and return `BotEvent[]`.
2. Cron jobs can persist/read state via a shared Drizzle SQLite store (`ctx.state`).
3. Events are forwarded to the Telegram processor.
4. Telegram processor formats events and sends messages via Telegram API.

## Install

```bash
bun install
```

## Configure

```bash
cp .env.example .env
```

Required:
- `TELEGRAM_BOT_TOKEN`

Recommended:
- `TELEGRAM_CHAT_ID` (default destination chat)
- `CRON_TIMEZONE`
- `RUN_JOBS_ON_STARTUP`
- `DATABASE_PATH`

## Run

```bash
bun run start
```

On startup, the app runs Drizzle migrations automatically via `migrate(...)`.

## Schema migrations

After changing `src/db/schema.ts`, generate a new SQL migration:

```bash
bun run db:generate
```

Commit the generated files in `drizzle/`. They will be applied automatically on app start.

## Add a new cron watcher

1. Create a new file in `src/cron/jobs/`.
2. Export a `CronJobDefinition`:

```ts
import type { CronJobDefinition } from "../types";

export const myWatcherJob: CronJobDefinition = {
  name: "my-watcher",
  schedule: "*/5 * * * *",
  async run(ctx) {
    const lastSeen = await ctx.state.getJson<{ value: string }>("my-watcher:last-seen");
    await ctx.state.setJson("my-watcher:last-seen", { value: "new-value" });

    return [
      {
        type: "info",
        source: "my-source",
        message: "Something changed",
      },
    ];
  },
};
```

3. Register it in `src/cron/jobs/index.ts`.

That is all you need. The cron runner will schedule it and send produced events to Telegram.
