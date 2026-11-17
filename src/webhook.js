const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_ATTEMPTS = 3;
const DEFAULT_DELAYS_MS = [1000, 3000];

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function createTimeout(timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    const reason = new Error('timeout');
    reason.name = 'TimeoutError';
    controller.abort(reason);
  }, timeoutMs);
  return {
    signal: controller.signal,
    cancel() {
      clearTimeout(timer);
    },
  };
}

function clip(text, max = 300) {
  const oneLine = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (!oneLine) return '';
  if (oneLine.length <= max) return oneLine;
  return `${oneLine.slice(0, max)}…`;
}

async function readBody(response) {
  try {
    if (typeof response?.text !== 'function') return '';
    return await response.text();
  } catch {
    return '';
  }
}

function formatStatus(status, text) {
  if (status >= 300 && status < 400) return `HTTP ${status} (redirect non seguito)`;
  const clipped = clip(text);
  return clipped ? `HTTP ${status} — ${clipped}` : `HTTP ${status}`;
}

function isTimeout(error) {
  return error?.name === 'TimeoutError' || error?.name === 'AbortError' || error?.cause?.name === 'TimeoutError';
}

function describeNetworkError(error) {
  if (isTimeout(error)) return 'timeout';
  const code = error?.cause?.code || error?.code;
  const message = error?.message || 'errore sconosciuto';
  return code ? `${message} (${code})` : message;
}

/**
 * POST JSON to the webhook. Retries network errors and HTTP 5xx.
 * Redirects are not followed, so the Authorization header cannot be sent to another host.
 * 4xx responses are not retried.
 */
export async function deliverWebhook({
  url,
  authorization,
  payload,
  fetchImpl = globalThis.fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxAttempts = DEFAULT_ATTEMPTS,
  delaysMs = DEFAULT_DELAYS_MS,
  sleepImpl = delay,
} = {}) {
  if (!url) throw new Error('WEBHOOK_URL mancante');
  if (!authorization) throw new Error('WEBHOOK_AUTHORIZATION mancante');

  const body = JSON.stringify(payload);
  let lastSummary = 'errore sconosciuto';
  let lastStatus = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const timer = createTimeout(timeoutMs);
    let retryable = false;
    try {
      const response = await fetchImpl(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization: authorization,
          'User-Agent': 'soource-discord-forwarder/1.0',
        },
        body,
        redirect: 'manual',
        signal: timer.signal,
      });

      if (response.ok) {
        return { ok: true, status: response.status, attempts: attempt, summary: `HTTP ${response.status}` };
      }

      const responseText = await readBody(response);
      lastStatus = response.status;
      lastSummary = formatStatus(response.status, responseText);
      retryable = response.status >= 500 && response.status <= 599;
      if (!retryable || attempt === maxAttempts) {
        return { ok: false, status: response.status, attempts: attempt, summary: lastSummary };
      }
    } catch (error) {
      lastStatus = null;
      lastSummary = `errore di rete: ${describeNetworkError(error)}`;
      retryable = true;
      if (attempt === maxAttempts) {
        return { ok: false, status: null, attempts: attempt, summary: lastSummary };
      }
    } finally {
      timer.cancel();
    }

    if (retryable && attempt < maxAttempts) {
      const delayMs = delaysMs[Math.min(attempt - 1, Math.max(delaysMs.length - 1, 0))] ?? 1000;
      await sleepImpl(delayMs);
    }
  }

  return { ok: false, status: lastStatus, attempts: maxAttempts, summary: lastSummary };
}
