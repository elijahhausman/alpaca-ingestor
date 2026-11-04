import "dotenv/config";

import { setTimeout as delay } from "node:timers/promises";
import { Alpaca, type Bar, TimeFrame } from "@alpacahq/alpaca-trade-api";

import { prisma } from "./prisma.ts";

const MINUTE = 60000;

const alpaca = new Alpaca({
  keyId: process.env.ALPACA_API_KEY!,
  secret: process.env.ALPACA_SECRET_KEY!,
});

const stream = alpaca.marketData.stockStream({
  feed: "iex",
  reconnect: true,
  maxReconnectAttempts: -1,
});

const buffer = new Map<string, Bar & { symbol: string }>();
const instruments = new Map<string, string>();
const symbols = ["AAPL", "MSFT", "SPY"];

let stopping = false;
let nextRecovery = 0;

function log(message: string) {
  console.log(`${new Date().toISOString()} ${message}`);
}

/**
 * Adds bars into a queue to be added into the database
 *
 * 1. Goes through conditions on when to skip the queue
 * 2. If it's safe to do so, it queues the bar
 * 3. If the buffer limit is reached, it triggers a recovery state
 */

// Adds bars into a queue to be added into the database
function enqueue(bar: Bar) {
  if (stopping || !bar.symbol || !symbols.includes(bar.symbol)) return;

  const key = `${bar.symbol}:${bar.timestamp.toISOString()}`;
  buffer.set(key, { ...bar, symbol: bar.symbol });

  if (buffer.size > 10000) {
    buffer.delete(buffer.keys().next().value!);
    nextRecovery = 0;

    console.warn("⚠️ Buffer limit reached (10k items)");
  }
}

/**
 * Creates a new bar in the database
 *
 * 1. First checks if the volume data is a positive integer
 * 2. Finds the instrument associated with the bar, and if it doesn't exist, it caches it
 * 3. Defines all the values needed to create a new bar
 * 4. Creates a new bar or updates one if it already exists
 */
async function storeBar(symbol: string, bar: Bar) {
  let instrumentId = instruments.get(symbol);

  if (!instrumentId) {
    const instrument = await prisma.instrument.upsert({
      where: {
        symbol,
      },
      create: {
        symbol,
        name: symbol,
        exchange: "iex",
      },
      update: {},
    });

    instrumentId = instrument.id;
    instruments.set(symbol, instrumentId!);
  }

  const values = {
    open: String(bar.open),
    high: String(bar.high),
    low: String(bar.low),
    close: String(bar.close),
    volume: BigInt(bar.volume),
    vwap: String(bar.vwap),
    tradeCount: bar.tradeCount ?? 0,
  };

  await prisma.bar.upsert({
    where: {
      instrumentId_timeframe_timestamp: {
        instrumentId,
        timeframe: "MIN_1",
        timestamp: bar.timestamp,
      },
    },
    create: {
      instrumentId,
      timestamp: bar.timestamp,
      timeframe: "MIN_1",
      ...values,
    },
    update: values,
  });
}

// Creates a snapshot of the buffer and goes through each item
async function push() {
  for (const [key, bar] of [...buffer]) {
    if (stopping) break;

    await storeBar(bar.symbol, bar);

    if (buffer.get(key) === bar) buffer.delete(key);
  }
}

/**
 * Goes to the Alpaca API to backfill missing data:
 *
 * 1. Goes through each symbol in our list
 * 2. Finds the last saved recovery point
 * 3. If a recovery was done in the past, then the recovery will go to that point (plus a buffer). If not, then it goes back one day
 * 4. A loop will run until it reaches our end point, where it fetches Alpaca data in 6-minute intervals and saves each chunk
 * 5. Lastly, the recovery state is saved to the database for future checks
 */
async function recover() {
  const end = new Date(Math.floor(Date.now() / MINUTE) * MINUTE - 2 * MINUTE);

  for (const symbol of symbols) {
    if (stopping) return;

    const checkpoint = await prisma.ingestion.findUnique({ where: { symbol } });

    let cursor = new Date(
      checkpoint
        ? checkpoint.lastSync.getTime() - 5 * MINUTE
        : end.getTime() - 48 * 24 * 60 * MINUTE,
    );

    while (cursor < end && !stopping) {
      const chunkEnd = new Date(
        Math.min(cursor.getTime() + 6 * 60 * MINUTE, end.getTime()),
      );
      const bars = await alpaca.marketData.getStockBarsFor(symbol, {
        timeframe: TimeFrame.Minute,
        start: cursor,
        end: chunkEnd,
        feed: "iex",
        adjustment: "raw",
        sort: "asc",
      });

      for (const bar of bars) {
        if (stopping) return;

        await storeBar(symbol, bar);
      }

      await prisma.ingestion.upsert({
        where: {
          symbol,
        },
        create: {
          symbol,
          lastSync: chunkEnd,
        },
        update: {
          lastSync: chunkEnd,
        },
      });

      log(
        `Synced ${symbol} from ${cursor.toISOString()} to ${chunkEnd.toISOString()} (${bars.length} bars)`,
      );
      cursor = chunkEnd;
    }
  }
}

/**
 * Stream settings
 *
 * 1. When Alpaca sends a new bar or an updated bar, it goes into the queue
 * 2. When the stream becomes connected, log the stocks, subscribe to the bars and upated bars, and trigger a recovery check
 * 3. When Alpaca has to reconnect, log each attempt and trigger a recovery
 * 4. If the stream disconnects, then log it in the console
 * 5. Lastly, when Alpaca errors, it's logged into the console
 */
stream.onBar(enqueue);
stream.onUpdatedBar(enqueue);

stream.onConnect(() => {
  log(`Stream connected! Listening for: ${symbols.join(", ")}`);

  stream.subscribeForBars(symbols);
  stream.subscribeForUpdatedBars(symbols);

  nextRecovery = 0;
});

stream.onReconnecting((attempt) =>
  log(`Reconnecting to stream... (attempt #${attempt})`),
);
stream.onReconnected(() => {
  nextRecovery = 0;
  log("Stream reconnected successfully!");
});

stream.onDisconnect(() => {
  if (!stopping) log("⚠️ Stream disconnected...");
});

stream.onError(() =>
  console.error(
    "An Alpaca error occured...",
  ),
);

// Safely stops the program and closes the software after 30 seconds if it fails
function stop() {
  if (stopping) return;

  stopping = true;

  log(`Stopping stream...`);

  stream.disconnect();

  setTimeout(() => process.exit(1), 30000).unref();
}

// If the server sends commands to stop, it'll listen and stop the proram
process.once("SIGINT", () => stop());
process.once("SIGTERM", () => stop());

/**
 * Starts the Alpaca stream and handles push and recovery logic
 *
 * 1. Starts the Alpaca stream and logs the success event
 * 2. If the program isn't stopping, it triggers a push and schedules minutely recoveries
 * 3. If the push or recovery fails, it logs the error in the console and waits 5 seconds before trying again
 * 4. Each loop waits one second before starting again
 */
async function main() {
  stream.connect();

  while (!stopping) {
    try {
      await push();

      if (Date.now() >= nextRecovery) {
        await recover();
        nextRecovery = Date.now() + MINUTE;
      }

      await push();
    } catch (error) {
      console.error("An unexpected error occured:", error);
      await delay(5000);
    }

    await delay(1000);
  }
}

/**
 * Starts the main program and logs if the program fails to start.
 * If it does, it closes the program, disconnects streams and prisma, and forcefully shuts down
 */
main()
  .catch((error) => {
    console.error("An unexpected error occured", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    stream.disconnect();
    await prisma.$disconnect();
  });
