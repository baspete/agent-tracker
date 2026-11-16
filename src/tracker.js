import { DevOpsError } from './devops.js';
import { Framebuffer } from './framebuffer.js';
import { renderFrame, brightnessFor } from './render.js';

const MAX_BACKOFF_MS = 300_000;
const SHOW_TIMEOUT_MS = 5_000;

function sleep(ms, signal) {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const t = setTimeout(done, ms);
    function done() {
      signal?.removeEventListener('abort', done);
      resolve();
    }
    signal?.addEventListener('abort', done, { once: true });
  });
}

function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('display show timed out')), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export function createTracker({
  config,
  fetchStatus,
  display,
  log = console,
  now = Date.now,
  showTimeoutMs = SHOW_TIMEOUT_MS,
}) {
  const intervalMs = config.pollIntervalSeconds * 1000;

  const state = {
    history: [],
    status: null,
    lastValue: null,
    lastError: null,
    consecutiveFailures: 0,
    lastSuccessAt: null,
  };

  let brightness = null;

  async function updateDisplay() {
    const t = now();
    const fb = new Framebuffer();
    renderFrame(fb, state, config, { now: t });
    const level = brightnessFor(state, config, t);
    try {
      if (level !== brightness && display.setBrightness) {
        await withTimeout(display.setBrightness(level), showTimeoutMs);
      }
      brightness = level;
      await withTimeout(display.show(fb), showTimeoutMs);
    } catch (err) {
      log.error(`display error: ${err.message}`);
      brightness = null; // re-send after the display is reset
      try {
        await display.reset?.();
      } catch {
        // best effort
      }
    }
  }

  async function tick(signal) {
    let delay;
    try {
      const status = await fetchStatus(signal);
      const value = status.busy;
      const changed = value !== state.lastValue;
      const recovered = state.consecutiveFailures;
      state.status = status;
      state.lastValue = value;
      state.history.push(value);
      while (state.history.length > config.samples) state.history.shift();
      state.lastError = null;
      state.consecutiveFailures = 0;
      state.lastSuccessAt = now();
      if (changed) log.info(`agents busy: ${value}`);
      if (recovered > 0) log.info(`recovered after ${recovered} failures`);
      delay = intervalMs;
    } catch (err) {
      if (!(err instanceof DevOpsError)) throw err;
      state.lastError = err;
      state.consecutiveFailures += 1;
      delay = Math.min(
        intervalMs * 2 ** (state.consecutiveFailures - 1),
        MAX_BACKOFF_MS
      );
      if (err.retryAfterMs) delay = Math.max(delay, err.retryAfterMs);
      log.error(
        `poll failed: kind=${err.kind} code=${err.code ?? '-'} ` +
          `status=${err.status ?? '-'} failures=${state.consecutiveFailures} ` +
          `retry_in=${Math.round(delay / 1000)}s`
      );
    }
    await updateDisplay();
    return delay;
  }

  async function run(signal) {
    while (!signal?.aborted) {
      try {
        const delay = await tick(signal);
        await sleep(delay, signal);
      } catch (err) {
        if (
          signal?.aborted &&
          (err === signal.reason || err?.name === 'AbortError')
        ) {
          return;
        }
        throw err;
      }
    }
  }

  return { state, tick, run };
}
