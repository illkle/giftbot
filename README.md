# giftbot

Telegram bot with a pluggable cron watcher layer:

1. Cron jobs run on a schedule and return `BotEvent[]`.
2. Cron jobs can persist/read state via a shared Drizzle SQLite store (`ctx.state`).
3. Active chats are tracked in SQLite (`/start` activates, `/stop` deactivates).
4. The feed watcher stores processed `(message_time, nft_link)` pairs to avoid reprocessing.
5. Events are forwarded to the Telegram processor.
6. Telegram processor formats events and sends messages via Telegram API.

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

## Feed watcher cron

Default cron: `giftwhalefeed-watcher` (every minute).

Flow:
1. Fetches `https://t.me/s/giftwhalefeed`.
2. Extracts message time + `https://t.me/nft/*` links.
3. Skips pairs already seen (`same time + same link`).
4. Fetches each unseen NFT page and parses `.tgme_gift_table`.
5. Sends stringified JSON payload to all active chats.

On first run, it performs an initial sync (marks current feed entries as seen) and starts sending only newly appearing entries afterward.

How to test:
1. Open your bot chat in Telegram and send `/start`.
2. Wait up to one minute.
3. You should receive JSON messages for newly seen feed items.
4. Send `/stop` to disable notifications for that chat.

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
