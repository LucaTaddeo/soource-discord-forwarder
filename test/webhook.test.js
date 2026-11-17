import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { deliverWebhook } from '../src/webhook.js';

const URL = 'https://hooks.example.test/inbound/secret-path';
const AUTHORIZATION = 'Bearer verbatim-secret-value';

function okResponse(status = 200, body = '') {
  // 204/205/304 cannot be constructed with a body in Node's fetch implementation.
  if (status === 204 || status === 205 || status === 304) return new Response(null, { status });
  return new Response(body, { status });
}

describe('deliverWebhook', () => {
  it('POSTs JSON and sends the Authorization header verbatim', async () => {
    let captured;
    let sleeps = 0;
    const result = await deliverWebhook({
      url: URL,
      authorization: AUTHORIZATION,
      payload: { server: 'Soource', mentions_owner: false },
      fetchImpl: async (url, options) => {
        captured = { url, options };
        return okResponse(204);
      },
      sleepImpl: async () => {
        sleeps += 1;
      },
    });

    assert.equal(result.ok, true);
    assert.equal(result.status, 204);
    assert.equal(result.attempts, 1);
    assert.equal(sleeps, 0);
    assert.equal(captured.url, URL);
    assert.equal(captured.options.method, 'POST');
    assert.equal(captured.options.redirect, 'manual');
    assert.equal(captured.options.headers.Authorization, AUTHORIZATION);
    assert.equal(captured.options.headers['Content-Type'], 'application/json');
    assert.deepEqual(JSON.parse(captured.options.body), { server: 'Soource', mentions_owner: false });
  });

  it('retries HTTP 5xx with backoff and then succeeds', async () => {
    const statuses = [502, 500, 200];
    const sleeps = [];
    let calls = 0;
    const result = await deliverWebhook({
      url: URL,
      authorization: AUTHORIZATION,
      payload: { ok: true },
      fetchImpl: async () => okResponse(statuses[calls++], calls === 1 ? 'upstream down' : ''),
      sleepImpl: async (ms) => {
        sleeps.push(ms);
      },
      delaysMs: [1000, 3000],
    });

    assert.equal(result.ok, true);
    assert.equal(result.status, 200);
    assert.equal(result.attempts, 3);
    assert.deepEqual(sleeps, [1000, 3000]);
    assert.equal(calls, 3);
  });

  it('retries a network error and stops after the last attempt', async () => {
    let calls = 0;
    const result = await deliverWebhook({
      url: URL,
      authorization: AUTHORIZATION,
      payload: { ok: true },
      maxAttempts: 2,
      delaysMs: [0],
      sleepImpl: async () => {},
      fetchImpl: async () => {
        calls += 1;
        const error = new Error(`connect ECONNREFUSED ${AUTHORIZATION}`);
        error.code = 'ECONNREFUSED';
        throw error;
      },
    });

    assert.equal(result.ok, false);
    assert.equal(calls, 2);
    assert.match(result.summary, /ECONNREFUSED/);
  });

  it('does not retry HTTP 4xx or redirects', async () => {
    for (const status of [401, 404, 302]) {
      let calls = 0;
      const result = await deliverWebhook({
        url: URL,
        authorization: AUTHORIZATION,
        payload: { ok: true },
        fetchImpl: async () => {
          calls += 1;
          return okResponse(status, `nope ${AUTHORIZATION}`);
        },
        sleepImpl: async () => {
          throw new Error('should not retry');
        },
      });
      assert.equal(result.ok, false, `status ${status}`);
      assert.equal(result.attempts, 1, `status ${status}`);
      assert.equal(calls, 1, `status ${status}`);
      assert.match(result.summary, new RegExp(String(status)));
    }
  });

  it('aborts a slow request and retries it as a timeout', async () => {
    let calls = 0;
    const result = await deliverWebhook({
      url: URL,
      authorization: AUTHORIZATION,
      payload: { ok: true },
      timeoutMs: 20,
      maxAttempts: 2,
      delaysMs: [0],
      sleepImpl: async () => {},
      fetchImpl: (_url, options) =>
        new Promise((resolve, reject) => {
          calls += 1;
          const onAbort = () => {
            const error = new Error('The operation was aborted due to timeout');
            error.name = 'TimeoutError';
            reject(error);
          };
          if (options.signal.aborted) {
            onAbort();
            return;
          }
          options.signal.addEventListener('abort', onAbort, { once: true });
          setTimeout(() => resolve(okResponse(200)), 1000).unref?.();
        }),
    });

    assert.equal(result.ok, false);
    assert.equal(calls, 2);
    assert.match(result.summary, /timeout/);
  });
});
