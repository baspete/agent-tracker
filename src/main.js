import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadConfig, ConfigError } from './config.js';
import { fetchPoolSnapshot } from './devops.js';
import { createTracker } from './tracker.js';
import { createSsd1322 } from './displays/ssd1322.js';
import { createConsoleDisplay } from './displays/console.js';

const SHUTDOWN_GRACE_MS = 3_000;

export async function main() {
  const rootDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  const envPath = path.join(rootDir, '.env');
  if (existsSync(envPath)) {
    process.loadEnvFile(envPath);
  }

  let config;
  try {
    config = loadConfig();
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(err.message);
      process.exit(78);
    }
    throw err;
  }

  const display =
    config.displayDriver === 'console'
      ? createConsoleDisplay()
      : createSsd1322({
          spiBus: config.spiBus,
          spiDevice: config.spiDevice,
          speedHz: config.spiSpeedHz,
          gpioChip: config.gpioChip,
          dcGpio: config.dcGpio,
          resetGpio: config.resetGpio,
          rotate: config.displayRotate,
        });

  const fetchStatus = (signal) =>
    fetchPoolSnapshot({
      org: config.org,
      poolId: config.poolId,
      pat: config.pat,
      timeoutMs: config.requestTimeoutSeconds * 1000,
      signal,
    });

  const tracker = createTracker({ config, fetchStatus, display });
  const ac = new AbortController();
  const loopDone = tracker.run(ac.signal);

  let exiting = false;
  const shutdown = async (code) => {
    if (exiting) return;
    exiting = true;
    ac.abort();
    try {
      await Promise.race([
        loopDone,
        new Promise((r) => setTimeout(r, SHUTDOWN_GRACE_MS)),
      ]);
    } catch {
      // loop errors are logged elsewhere
    }
    try {
      await display.off();
    } catch {}
    try {
      await display.close();
    } catch {}
    process.exit(code);
  };

  process.on('SIGINT', () => void shutdown(0));
  process.on('SIGTERM', () => void shutdown(0));
  process.on('unhandledRejection', (err) => {
    console.error(err?.stack ?? err);
    void shutdown(1);
  });
  process.on('uncaughtException', (err) => {
    console.error(err?.stack ?? err);
    void shutdown(1);
  });

  loopDone.then(
    () => void shutdown(0),
    (err) => {
      console.error(err?.stack ?? err);
      void shutdown(1);
    }
  );
}
