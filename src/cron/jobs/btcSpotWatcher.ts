import type { BotEvent } from "../../events/types";
import type { CronJobDefinition } from "../types";

type CoinbasePriceResponse = {
  data?: {
    amount?: string;
    currency?: string;
    base?: string;
  };
};

const COINBASE_SPOT_PRICE_URL = "https://api.coinbase.com/v2/prices/BTC-USD/spot";
const MIN_PERCENT_DELTA_TO_NOTIFY = 0.5;
const LAST_PRICE_STATE_KEY = "btc-spot-watcher:last-price-usd";

export const btcSpotWatcherJob: CronJobDefinition = {
  name: "btc-spot-watcher",
  schedule: "*/2 * * * *",
  async run(ctx) {
    const events: BotEvent[] = [];
    const { logger, state } = ctx;

    try {
      const response = await fetch(COINBASE_SPOT_PRICE_URL);
      if (!response.ok) {
        events.push({
          type: "external_api_error",
          source: "coinbase-btc-spot",
          message: `HTTP ${response.status} from Coinbase spot price API`,
        });
        return events;
      }

      const payload = (await response.json()) as CoinbasePriceResponse;
      const amount = payload.data?.amount;
      if (!amount) {
        events.push({
          type: "external_api_error",
          source: "coinbase-btc-spot",
          message: "Coinbase response did not contain data.amount",
        });
        return events;
      }

      const currentPrice = Number(amount);
      if (Number.isNaN(currentPrice)) {
        events.push({
          type: "external_api_error",
          source: "coinbase-btc-spot",
          message: `Invalid numeric amount: "${amount}"`,
        });
        return events;
      }

      const lastPriceUsd = await state.getNumber(LAST_PRICE_STATE_KEY);
      if (lastPriceUsd === undefined) {
        await state.setNumber(LAST_PRICE_STATE_KEY, currentPrice);
        logger.info(`[btc-spot-watcher] initialized baseline price at $${currentPrice.toFixed(2)}`);
        return events;
      }

      const delta = currentPrice - lastPriceUsd;
      const percentChange = (delta / lastPriceUsd) * 100;
      if (Math.abs(percentChange) >= MIN_PERCENT_DELTA_TO_NOTIFY) {
        events.push({
          type: "external_api_change",
          source: "coinbase-btc-spot",
          message: `BTC changed ${percentChange.toFixed(2)}%: $${lastPriceUsd.toFixed(2)} -> $${currentPrice.toFixed(2)}`,
          metadata: {
            previous_usd: lastPriceUsd.toFixed(2),
            current_usd: currentPrice.toFixed(2),
            change_percent: percentChange.toFixed(2),
          },
        });
      }

      await state.setNumber(LAST_PRICE_STATE_KEY, currentPrice);
      return events;
    } catch (error) {
      logger.error("[btc-spot-watcher] fetch failed", error);
      events.push({
        type: "external_api_error",
        source: "coinbase-btc-spot",
        message: `Failed to fetch Coinbase spot price: ${String(error)}`,
      });
      return events;
    }
  },
};
