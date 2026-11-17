import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';
import { conversationKey, createForwardBatcher, isOwnMessage } from '../src/batch.js';

function entry(id, overrides = {}) {
  return {
    key: '200',
    messageId: id,
    server: 'Soource',
    serverId: '100',
    channel: 'generale',
    channelId: '200',
    thread: null,
    threadId: null,
    parentChannel: null,
    parentChannelId: null,
    author: 'Ada',
    authorId: '30',
    content: id,
    attachments: [],
    embedTitles: [],
    url: `https://discord.com/channels/100/200/${id}`,
    mentionsOwner: false,
    isReplyToOwner: false,
    isDm: false,
    createdAt: '2026-11-17T12:00:00.000Z',
    ...overrides,
  };
}

function idsOf(batches) {
  return batches.map((batch) => batch.map((item) => item.messageId).join('+')).sort();
}

describe('conversationKey', () => {
  it('uses the thread id for a thread and the channel id for channels and DMs', () => {
    assert.equal(
      conversationKey({
        channelId: 'parent',
        channel: { id: 'thread-9', isThread: () => true },
      }),
      'thread-9',
    );
    assert.equal(
      conversationKey({
        channelId: 'dm-1',
        channel: { id: 'dm-1', isDMBased: () => true, isThread: () => false },
      }),
      'dm-1',
    );
    assert.equal(conversationKey({ channelId: '200', channel: { id: '200', isThread: () => false } }), '200');
    assert.equal(conversationKey({ channelId: '200' }), '200');
  });
});

describe('forward batching', () => {
  beforeEach(() => {
    mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  });

  afterEach(() => {
    mock.timers.reset();
  });

  function batcher(overrides = {}) {
    const flushed = [];
    const api = createForwardBatcher({
      debounceMs: 120_000,
      maxBatch: 20,
      maxWaitMs: 600_000,
      onFlush(entries) {
        flushed.push(entries);
      },
      ...overrides,
    });
    return { ...api, flushed };
  }

  it('sends one batch after the quiet period and does not mix conversations', async () => {
    const forwarder = batcher();
    await forwarder.push(entry('a', { key: 'ch-1', channelId: 'ch-1' }));
    await forwarder.push(entry('b', { key: 'ch-2', channelId: 'ch-2' }));
    await forwarder.push(entry('c', { key: 'ch-1', channelId: 'ch-1' }));

    mock.timers.tick(119_999);
    await forwarder.idle();
    assert.equal(forwarder.flushed.length, 0);

    mock.timers.tick(1);
    await forwarder.idle();
    assert.deepEqual(idsOf(forwarder.flushed), ['a+c', 'b']);
  });

  it('resets the quiet timer when another message arrives in the same conversation', async () => {
    const forwarder = batcher();
    await forwarder.push(entry('a'));
    mock.timers.tick(119_000);
    await forwarder.push(entry('b'));
    mock.timers.tick(119_000);
    await forwarder.idle();
    assert.equal(forwarder.flushed.length, 0);

    mock.timers.tick(1_000);
    await forwarder.idle();
    assert.deepEqual(idsOf(forwarder.flushed), ['a+b']);
  });

  it('flushes as soon as the batch reaches the maximum size', async () => {
    const forwarder = batcher({ maxBatch: 3 });
    await forwarder.push(entry('a'));
    await forwarder.push(entry('b'));
    await forwarder.push(entry('x', { key: 'other', channelId: 'other' }));
    assert.equal(forwarder.flushed.length, 0);

    await forwarder.push(entry('c'));
    await forwarder.idle();
    assert.deepEqual(idsOf(forwarder.flushed), ['a+b+c']);

    mock.timers.tick(120_000);
    await forwarder.idle();
    assert.deepEqual(idsOf(forwarder.flushed), ['a+b+c', 'x']);
  });

  it('flushes when the first message has been waiting for the maximum time', async () => {
    const forwarder = batcher({ debounceMs: 120_000, maxWaitMs: 300_000, maxBatch: 20 });
    await forwarder.push(entry('a'));
    mock.timers.tick(100_000);
    await forwarder.push(entry('b'));
    mock.timers.tick(100_000);
    await forwarder.push(entry('c'));
    await forwarder.idle();
    assert.equal(forwarder.flushed.length, 0);

    mock.timers.tick(100_000);
    await forwarder.idle();
    assert.deepEqual(idsOf(forwarder.flushed), ['a+b+c']);

    mock.timers.tick(120_000);
    await forwarder.idle();
    assert.equal(forwarder.flushed.length, 1);
  });

  it('flushes every pending batch on shutdown', async () => {
    const forwarder = batcher();
    await forwarder.push(entry('a', { key: 'ch-1', channelId: 'ch-1' }));
    await forwarder.push(entry('b', { key: 'ch-1', channelId: 'ch-1' }));
    await forwarder.push(entry('c', { key: 'dm-1', channelId: 'dm-1', isDm: true }));
    assert.equal(forwarder.pendingCount(), 3);

    await forwarder.flushAll();
    await forwarder.idle();
    assert.equal(forwarder.pendingCount(), 0);
    assert.deepEqual(idsOf(forwarder.flushed), ['a+b', 'c']);

    mock.timers.tick(120_000);
    await forwarder.idle();
    assert.equal(forwarder.flushed.length, 2);
  });

  it('ignores the bot own messages and does not reset the quiet timer', async () => {
    assert.equal(isOwnMessage({ author: { id: 'bot' } }, 'bot'), true);
    assert.equal(isOwnMessage({ authorId: 'bot' }, 'bot'), true);
    assert.equal(isOwnMessage({ author: { id: '30' } }, 'bot'), false);
    assert.equal(isOwnMessage({ author: { id: 'bot' } }, null), false);

    const forwarder = batcher({ botUserId: () => 'bot' });
    await forwarder.push(entry('user', { authorId: '30' }));
    mock.timers.tick(60_000);
    const ignored = await forwarder.push(entry('self', { authorId: 'bot' }));
    assert.equal(ignored.reason, 'own');
    assert.equal(forwarder.pendingCount(), 1);

    mock.timers.tick(60_000);
    await forwarder.idle();
    assert.deepEqual(idsOf(forwarder.flushed), ['user']);
    assert.equal(forwarder.flushed[0][0].authorId, '30');
  });

  it('posts each message immediately when debounce is disabled', async () => {
    const forwarder = batcher({ debounceMs: 0 });
    await forwarder.push(entry('a'));
    await forwarder.push(entry('b'));
    await forwarder.idle();
    assert.deepEqual(idsOf(forwarder.flushed), ['a', 'b']);

    mock.timers.tick(120_000);
    await forwarder.idle();
    assert.equal(forwarder.flushed.length, 2);
  });
});
