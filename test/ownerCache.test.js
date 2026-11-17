import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createOwnerCache } from '../src/ownerCache.js';

describe('createOwnerCache', () => {
  it('reuses a value inside the ttl and refreshes it afterwards', async () => {
    let now = 1_000;
    let calls = 0;
    const cache = createOwnerCache({ ttlMs: 50, now: () => now });
    const first = await cache.get('g:u', async () => {
      calls += 1;
      return { roleIds: ['1'] };
    });
    const second = await cache.get('g:u', async () => {
      calls += 1;
      return { roleIds: ['2'] };
    });
    now = 1_060;
    const third = await cache.get('g:u', async () => {
      calls += 1;
      return { roleIds: ['3'] };
    });

    assert.deepEqual(first, { roleIds: ['1'] });
    assert.deepEqual(second, { roleIds: ['1'] });
    assert.deepEqual(third, { roleIds: ['3'] });
    assert.equal(calls, 2);
  });

  it('does not cache a null result or a thrown error', async () => {
    let now = 0;
    let calls = 0;
    const cache = createOwnerCache({ ttlMs: 50, now: () => now });
    assert.equal(await cache.get('missing', async () => null), null);
    await assert.rejects(
      cache.get('boom', async () => {
        calls += 1;
        throw new Error('no');
      }),
      /no/,
    );
    await assert.rejects(
      cache.get('boom', async () => {
        calls += 1;
        throw new Error('no');
      }),
      /no/,
    );
    assert.equal(calls, 2);
    assert.equal(cache.size(), 0);
  });
});
