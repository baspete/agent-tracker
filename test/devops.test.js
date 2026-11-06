import { test } from 'node:test';
import assert from 'node:assert/strict';

import { fetchBusyAgentCount, DevOpsError } from '../src/devops.js';

const PAT = 'sekret-pat-value';
const base = { org: 'my-org', poolId: 27, pat: PAT, timeoutMs: 5000 };

function jsonResponse(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

const agents = (...states) => ({
  value: states.map((s) => ({ provisioningState: s })),
});

test('200 counts only RunningRequest and Provisioning', async () => {
  const fetchImpl = async () =>
    jsonResponse(
      agents('RunningRequest', 'Provisioning', 'Idle', 'RunningRequest', 'Offline')
    );
  assert.equal(await fetchBusyAgentCount({ ...base, fetchImpl }), 3);
});

test('exact URL and Authorization header', async () => {
  let seen;
  const fetchImpl = async (url, opts) => {
    seen = { url, opts };
    return jsonResponse(agents());
  };
  await fetchBusyAgentCount({ ...base, fetchImpl });
  assert.equal(
    seen.url,
    'https://dev.azure.com/my-org/_apis/distributedtask/pools/27/agents?api-version=7.1'
  );
  const expected = `Basic ${Buffer.from(`:${PAT}`).toString('base64')}`;
  const headers = new Headers(seen.opts.headers);
  assert.equal(headers.get('authorization'), expected);
  assert.equal(headers.get('accept'), 'application/json');
  assert.equal(seen.opts.redirect, 'manual');
});

for (const [label, res] of [
  ['401', jsonResponse({}, 401)],
  ['203 + HTML', new Response('<html>sign in</html>', { status: 203 })],
  [
    '302',
    new Response(null, { status: 302, headers: { location: 'https://x' } }),
  ],
]) {
  test(`${label} gives kind=auth`, async () => {
    const fetchImpl = async () => res.clone();
    await assert.rejects(
      fetchBusyAgentCount({ ...base, fetchImpl }),
      (err) => {
        assert.ok(err instanceof DevOpsError);
        assert.equal(err.kind, 'auth');
        return true;
      }
    );
  });
}

test('500 gives kind=http', async () => {
  const fetchImpl = async () => jsonResponse({}, 500);
  await assert.rejects(fetchBusyAgentCount({ ...base, fetchImpl }), (err) => {
    assert.equal(err.kind, 'http');
    assert.equal(err.status, 500);
    return true;
  });
});

test('429 with Retry-After: 120 gives retryAfterMs 120000', async () => {
  const fetchImpl = async () =>
    jsonResponse({}, 429, { 'retry-after': '120' });
  await assert.rejects(fetchBusyAgentCount({ ...base, fetchImpl }), (err) => {
    assert.equal(err.kind, 'http');
    assert.equal(err.retryAfterMs, 120000);
    return true;
  });
});

test('non-array value gives kind=parse', async () => {
  const fetchImpl = async () => jsonResponse({ value: 'nope' });
  await assert.rejects(fetchBusyAgentCount({ ...base, fetchImpl }), (err) => {
    assert.equal(err.kind, 'parse');
    return true;
  });
});

test('text/html 200 gives kind=parse', async () => {
  const fetchImpl = async () =>
    new Response('<html></html>', {
      status: 200,
      headers: { 'content-type': 'text/html' },
    });
  await assert.rejects(fetchBusyAgentCount({ ...base, fetchImpl }), (err) => {
    assert.equal(err.kind, 'parse');
    return true;
  });
});

test('TypeError with cause.code gives kind=network with code', async () => {
  const fetchImpl = async () => {
    throw new TypeError('fetch failed', { cause: { code: 'EAI_AGAIN' } });
  };
  await assert.rejects(fetchBusyAgentCount({ ...base, fetchImpl }), (err) => {
    assert.equal(err.kind, 'network');
    assert.equal(err.code, 'EAI_AGAIN');
    return true;
  });
});

test('timeoutMs expiry gives kind=timeout', async () => {
  const fetchImpl = (url, opts) =>
    new Promise((_, reject) => {
      opts.signal.addEventListener('abort', () =>
        reject(opts.signal.reason ?? new DOMException('aborted', 'AbortError'))
      );
    });
  await assert.rejects(
    fetchBusyAgentCount({ ...base, timeoutMs: 20, fetchImpl }),
    (err) => {
      assert.equal(err.kind, 'timeout');
      return true;
    }
  );
});

test('401 response body is cancelled before throwing', async () => {
  let cancelled = false;
  const body = new ReadableStream({
    start(c) {
      c.enqueue(new TextEncoder().encode('<html>denied</html>'));
      c.close();
    },
    cancel() {
      cancelled = true;
    },
  });
  const fetchImpl = async () => new Response(body, { status: 401 });
  await assert.rejects(fetchBusyAgentCount({ ...base, fetchImpl }), (err) => {
    assert.equal(err.kind, 'auth');
    return true;
  });
  assert.ok(cancelled);
});

test('hanging body gives kind=timeout when timeoutMs expires', async () => {
  const body = new ReadableStream({ start() {} }); // never enqueues
  const fetchImpl = async () =>
    new Response(body, {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  await assert.rejects(
    fetchBusyAgentCount({ ...base, timeoutMs: 20, fetchImpl }),
    (err) => {
      assert.equal(err.kind, 'timeout');
      return true;
    }
  );
});

test('caller abort while reading body rethrows the abort error', async () => {
  const ac = new AbortController();
  const body = new ReadableStream({ start() {} }); // never enqueues
  const fetchImpl = async () =>
    new Response(body, {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  const p = fetchBusyAgentCount({ ...base, signal: ac.signal, fetchImpl });
  setTimeout(() => ac.abort(), 10);
  await assert.rejects(p, (err) => {
    assert.ok(!(err instanceof DevOpsError));
    assert.ok(err instanceof DOMException);
    return true;
  });
});

test('caller abort rethrows the abort error', async () => {
  const ac = new AbortController();
  const fetchImpl = (url, opts) =>
    new Promise((_, reject) => {
      opts.signal.addEventListener('abort', () =>
        reject(new DOMException('This operation was aborted', 'AbortError'))
      );
    });
  const p = fetchBusyAgentCount({ ...base, signal: ac.signal, fetchImpl });
  ac.abort();
  await assert.rejects(p, (err) => {
    assert.ok(!(err instanceof DevOpsError));
    assert.equal(err.name, 'AbortError');
    return true;
  });
});

test('PAT never appears in any error', async () => {
  const cases = [
    async () => jsonResponse({}, 401),
    async () => new Response('<html></html>', { status: 203 }),
    async () => jsonResponse({}, 500),
    async () => jsonResponse({ value: 1 }),
    async () => {
      throw new TypeError('fetch failed', { cause: { code: 'EAI_AGAIN' } });
    },
  ];
  for (const fetchImpl of cases) {
    await assert.rejects(
      fetchBusyAgentCount({ ...base, fetchImpl }),
      (err) => {
        assert.ok(!String(err).includes(PAT), String(err));
        assert.ok(!err.message.includes(PAT));
        return true;
      }
    );
  }
});
