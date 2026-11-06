export class DevOpsError extends Error {
  constructor(kind, message, { status, code, retryAfterMs } = {}) {
    super(message);
    this.name = 'DevOpsError';
    this.kind = kind;
    if (status !== undefined) this.status = status;
    if (code !== undefined) this.code = code;
    if (retryAfterMs !== undefined) this.retryAfterMs = retryAfterMs;
  }
}

function cancelBody(res) {
  // Not awaited: a teed or locked stream's cancel() can stay pending forever,
  // and starting the cancellation is enough to release the socket.
  try {
    res.body?.cancel().catch(() => {});
  } catch {
    // best effort
  }
}

function retryAfterMs(res) {
  const raw = res.headers.get('retry-after');
  if (!raw) return undefined;
  const seconds = Number(raw);
  if (!Number.isFinite(seconds) || seconds < 0) return undefined;
  return Math.round(seconds * 1000);
}

export async function fetchBusyAgentCount({
  org,
  poolId,
  pat,
  timeoutMs,
  signal,
  fetchImpl = globalThis.fetch,
}) {
  const url = `https://dev.azure.com/${encodeURIComponent(
    org
  )}/_apis/distributedtask/pools/${poolId}/agents?api-version=7.1`;
  const auth = Buffer.from(`:${pat}`).toString('base64');

  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const combined = AbortSignal.any(
    [timeoutSignal, signal].filter(Boolean)
  );

  let res;
  try {
    res = await fetchImpl(url, {
      method: 'GET',
      headers: {
        Authorization: `Basic ${auth}`,
        Accept: 'application/json',
      },
      redirect: 'manual',
      signal: combined,
    });
  } catch (err) {
    if (timeoutSignal.aborted) {
      throw new DevOpsError('timeout', `request timed out after ${timeoutMs}ms`);
    }
    if (signal && signal.aborted) {
      throw err;
    }
    if (err instanceof TypeError) {
      throw new DevOpsError('network', `network error: ${err.message}`, {
        code: err.cause?.code,
      });
    }
    throw err;
  }

  const status = res.status;
  const isRedirect =
    res.type === 'opaqueredirect' || (status >= 300 && status < 400);
  if (status === 401 || status === 403 || status === 203 || isRedirect) {
    cancelBody(res);
    throw new DevOpsError('auth', `authentication failed (status ${status})`, {
      status,
    });
  }
  if (status < 200 || status >= 300) {
    cancelBody(res);
    throw new DevOpsError('http', `unexpected status ${status}`, {
      status,
      retryAfterMs:
        status === 429 || status === 503 ? retryAfterMs(res) : undefined,
    });
  }

  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('json')) {
    cancelBody(res);
    throw new DevOpsError('parse', `unexpected content-type: ${contentType}`, {
      status,
    });
  }
  let body;
  try {
    body = await new Promise((resolve, reject) => {
      res.json().then(resolve, reject);
      combined.addEventListener('abort', () => reject(combined.reason), {
        once: true,
      });
    });
  } catch (err) {
    cancelBody(res);
    if (timeoutSignal.aborted) {
      throw new DevOpsError('timeout', `request timed out after ${timeoutMs}ms`);
    }
    if (signal && signal.aborted) {
      throw err;
    }
    throw new DevOpsError('parse', 'response body was not valid JSON', {
      status,
    });
  }
  if (!body || !Array.isArray(body.value)) {
    throw new DevOpsError('parse', 'response JSON had no value array', {
      status,
    });
  }

  return body.value.filter(
    (a) =>
      a.provisioningState === 'RunningRequest' ||
      a.provisioningState === 'Provisioning'
  ).length;
}
