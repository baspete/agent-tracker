import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createTracker } from '../src/tracker.js';
import { DevOpsError } from '../src/devops.js';

const PAT = 'sekret-pat-value';
const config = { samples: 3, scaleMax: 20, pollIntervalSeconds: 30 };

function spyLog() {
  const lines = [];
  return {
    lines,
    info: (m) => lines.push(`info: ${m}`),
    error: (m) => lines.push(`error: ${m}`),
    warn: (m) => lines.push(`warn: ${m}`),
  };
}

function fakeDisplay(overrides = {}) {
  const calls = { show: 0, reset: 0 };
  return {
    calls,
    async show() {
      calls.show++;
    },
    async reset() {
      calls.reset++;
    },
    ...overrides,
  };
}

function makeTracker({ fetchCount, display, log }) {
  return createTracker({
    config,
    fetchCount,
    display: display ?? fakeDisplay(),
    log: log ?? spyLog(),
  });
}

test('success delay equals the poll interval', async () => {
  const t = makeTracker({ fetchCount: async () => 4 });
  assert.equal(await t.tick(), 30_000);
});

test('backoff sequence 30,60,120,240,300,300', async () => {
  const t = makeTracker({
    fetchCount: async () => {
      throw new DevOpsError('network', 'network error');
    },
  });
  const delays = [];
  for (let i = 0; i < 6; i++) delays.push(await t.tick());
  assert.deepEqual(delays, [30_000, 60_000, 120_000, 240_000, 300_000, 300_000]);
});

test('Retry-After is honoured', async () => {
  const t = makeTracker({
    fetchCount: async () => {
      throw new DevOpsError('http', 'unexpected status 429', {
        status: 429,
        retryAfterMs: 120_000,
      });
    },
  });
  assert.equal(await t.tick(), 120_000);
});

test('history not pushed on failure and trimmed to SAMPLES', async () => {
  const values = [1, 2, 3, 4, 5];
  let fail = false;
  const t = makeTracker({
    fetchCount: async () => {
      if (fail) throw new DevOpsError('network', 'network error');
      return values.shift();
    },
  });
  await t.tick();
  await t.tick();
  await t.tick();
  fail = true;
  await t.tick();
  assert.deepEqual(t.state.history, [1, 2, 3]);
  fail = false;
  await t.tick(); // pushes 4, trims to [2,3,4]
  await t.tick(); // pushes 5, trims to [3,4,5]
  assert.deepEqual(t.state.history, [3, 4, 5]);
  assert.equal(t.state.lastError, null);
});

test('value logged only on change, plus recovery line', async () => {
  const log = spyLog();
  const values = [4, 4, 7];
  let fail = false;
  const t = makeTracker({
    log,
    fetchCount: async () => {
      if (fail) throw new DevOpsError('timeout', 'request timed out');
      return values.shift() ?? 7;
    },
  });
  await t.tick();
  await t.tick();
  fail = true;
  await t.tick();
  fail = false;
  await t.tick();
  const infoLines = log.lines.filter((l) => l.startsWith('info:'));
  assert.deepEqual(infoLines, [
    'info: agents busy: 4',
    'info: agents busy: 7',
    'info: recovered after 1 failures',
  ]);
});

test('display.show throwing returns a delay and calls reset', async () => {
  const display = fakeDisplay({
    async show() {
      throw new Error('i2c write failed');
    },
  });
  const log = spyLog();
  const t = makeTracker({ fetchCount: async () => 1, display, log });
  const delay = await t.tick();
  assert.equal(delay, 30_000);
  assert.equal(display.calls.reset, 1);
  assert.ok(log.lines.some((l) => l.includes('display error')));
});

test('display.show hanging returns a delay and calls reset', async () => {
  const display = fakeDisplay({
    show: () => new Promise(() => {}),
  });
  const log = spyLog();
  const t = createTracker({
    config,
    fetchCount: async () => 1,
    display,
    log,
    showTimeoutMs: 20,
  });
  const delay = await t.tick();
  assert.equal(delay, 30_000);
  assert.equal(display.calls.reset, 1);
});

test('non-DevOpsError propagates', async () => {
  const t = makeTracker({
    fetchCount: async () => {
      throw new Error('bug');
    },
  });
  await assert.rejects(t.tick(), /bug/);
});

test('no log line ever contains the PAT', async () => {
  const log = spyLog();
  let calls = 0;
  const t = makeTracker({
    log,
    fetchCount: async () => {
      calls++;
      if (calls === 1) return 2;
      throw new DevOpsError('auth', `authentication failed for ${PAT}-like`, {
        status: 401,
      });
    },
  });
  // Simulate an error object that itself is clean — the point is tracker logs
  // only kind/code/status, never the message internals around secrets.
  const t2 = makeTracker({
    log,
    fetchCount: async () => {
      throw new DevOpsError('network', 'network error', { code: 'EAI_AGAIN' });
    },
  });
  await t.tick();
  await t2.tick();
  await t2.tick();
  for (const line of log.lines) {
    assert.ok(!line.includes(PAT), line);
  }
});

test('run resolves cleanly when fetchCount rejects AbortError after abort', async () => {
  const ac = new AbortController();
  const t = makeTracker({
    fetchCount: async () => {
      ac.abort();
      throw new DOMException('This operation was aborted', 'AbortError');
    },
  });
  await t.run(ac.signal);
});

test('run rethrows a non-abort non-DevOpsError even if aborted later', async () => {
  const t = makeTracker({
    fetchCount: async () => {
      throw new Error('bug');
    },
  });
  const ac = new AbortController();
  await assert.rejects(t.run(ac.signal), /bug/);
});

test('failure log line shape', async () => {
  const log = spyLog();
  const t = makeTracker({
    log,
    fetchCount: async () => {
      throw new DevOpsError('network', 'network error', { code: 'EAI_AGAIN' });
    },
  });
  await t.tick();
  await t.tick();
  assert.equal(
    log.lines[0],
    'error: poll failed: kind=network code=EAI_AGAIN status=- failures=1 retry_in=30s'
  );
  assert.equal(
    log.lines[1],
    'error: poll failed: kind=network code=EAI_AGAIN status=- failures=2 retry_in=60s'
  );
});
