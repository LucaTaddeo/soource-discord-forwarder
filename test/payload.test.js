import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PAYLOAD_FIELDS, buildBatchPayload, buildPayload, samplePayload } from '../src/payload.js';

describe('buildPayload', () => {
  it('uses the webhook field names and boolean flags', () => {
    const payload = buildPayload({
      server: 'Soource',
      serverId: '100',
      channel: 'generale',
      channelId: '200',
      author: 'Ada',
      authorId: '30',
      content: 'ciao <@10>',
      attachments: ['https://cdn.example/a.png'],
      embedTitles: ['Titolo'],
      url: 'https://discord.com/channels/100/200/9',
      mentionsOwner: true,
      isReplyToOwner: false,
      isDm: false,
      createdAt: '2026-01-02T03:04:05.000Z',
    });

    assert.deepEqual(Object.keys(payload), PAYLOAD_FIELDS);
    assert.equal(payload.server, 'Soource');
    assert.equal(payload.server_id, '100');
    assert.equal(payload.channel, 'generale');
    assert.equal(payload.channel_id, '200');
    assert.equal(payload.author, 'Ada');
    assert.equal(payload.author_id, '30');
    assert.equal(payload.content, 'ciao <@10>\n\nhttps://cdn.example/a.png\n\nEmbed: Titolo');
    assert.equal(payload.url, 'https://discord.com/channels/100/200/9');
    assert.equal(payload.mentions_owner, true);
    assert.equal(payload.is_reply_to_owner, false);
    assert.equal(payload.is_dm, false);
    assert.equal(payload.created_at, '2026-01-02T03:04:05.000Z');
  });

  it('uses null for a direct message server', () => {
    const payload = buildPayload({
      server: null,
      serverId: null,
      channel: 'DM',
      channelId: 'dm',
      author: 'Ada',
      authorId: '30',
      content: 'privato',
      url: 'https://discord.com/channels/@me/dm/9',
      isDm: true,
      createdAt: '2026-01-02T03:04:05.000Z',
    });
    assert.equal(payload.server, null);
    assert.equal(payload.server_id, null);
    assert.equal(payload.is_dm, true);
    assert.equal(payload.mentions_owner, false);
  });
});

describe('samplePayload', () => {
  it('matches the live payload fields', () => {
    const sample = samplePayload(new Date('2026-04-01T00:00:00.000Z'));
    for (const field of PAYLOAD_FIELDS) {
      assert.equal(Object.hasOwn(sample, field), true, field);
    }
    assert.equal(sample.created_at, '2026-04-01T00:00:00.000Z');
    assert.equal(sample.is_dm, false);
    assert.equal(sample.message_count, 1);
    assert.equal(sample.messages.length, 1);
    assert.equal(sample.messages[0].timestamp, '2026-04-01T00:00:00.000Z');
    assert.equal(typeof sample.content, 'string');
    assert.ok(sample.content.length > 0);
  });
});

describe('buildBatchPayload', () => {
  function entry(overrides = {}) {
    return {
      messageId: '1',
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
      content: 'ciao',
      attachments: [],
      embedTitles: [],
      url: 'https://discord.com/channels/100/200/1',
      mentionsOwner: false,
      isReplyToOwner: false,
      isDm: false,
      createdAt: '2026-11-17T12:00:00.000Z',
      ...overrides,
    };
  }

  it('keeps the legacy fields from the last message and reports the whole group', () => {
    const payload = buildBatchPayload([
      entry({
        messageId: '1',
        author: 'Ada',
        authorId: '30',
        content: 'prima parte',
        mentionsOwner: true,
        createdAt: '2026-11-17T12:00:00.000Z',
        url: 'https://discord.com/channels/100/200/1',
      }),
      entry({
        messageId: '2',
        author: 'Ada',
        authorId: '30',
        content: 'seconda parte',
        attachments: ['https://cdn.example/foto.png'],
        embedTitles: ['Report'],
        mentionsOwner: false,
        isReplyToOwner: true,
        createdAt: '2026-11-17T12:00:05.000Z',
        url: 'https://discord.com/channels/100/200/2',
        thread: 'topic',
        threadId: '200',
        parentChannel: 'generale',
        parentChannelId: '150',
        channel: 'topic',
      }),
    ]);

    for (const field of PAYLOAD_FIELDS) {
      assert.equal(Object.hasOwn(payload, field), true, field);
    }
    assert.equal(payload.author, 'Ada');
    assert.equal(payload.author_id, '30');
    assert.equal(payload.content, 'seconda parte\n\nhttps://cdn.example/foto.png\n\nEmbed: Report');
    assert.equal(payload.url, 'https://discord.com/channels/100/200/2');
    assert.equal(payload.created_at, '2026-11-17T12:00:05.000Z');
    assert.equal(payload.is_reply_to_owner, true);
    assert.equal(payload.mentions_owner, true);
    assert.equal(payload.server, 'Soource');
    assert.equal(payload.server_id, '100');
    assert.equal(payload.channel, 'topic');
    assert.equal(payload.channel_id, '200');
    assert.equal(payload.thread, 'topic');
    assert.equal(payload.thread_id, '200');
    assert.equal(payload.parent_channel, 'generale');
    assert.equal(payload.parent_channel_id, '150');
    assert.equal(payload.message_count, 2);
    assert.equal(payload.first_timestamp, '2026-11-17T12:00:00.000Z');
    assert.equal(payload.last_timestamp, '2026-11-17T12:00:05.000Z');
    assert.deepEqual(payload.messages, [
      {
        id: '1',
        author: 'Ada',
        author_id: '30',
        content: 'prima parte',
        timestamp: '2026-11-17T12:00:00.000Z',
        url: 'https://discord.com/channels/100/200/1',
        attachments: [],
        mentions_owner: true,
        is_reply_to_owner: false,
      },
      {
        id: '2',
        author: 'Ada',
        author_id: '30',
        content: 'seconda parte\n\nEmbed: Report',
        timestamp: '2026-11-17T12:00:05.000Z',
        url: 'https://discord.com/channels/100/200/2',
        attachments: ['https://cdn.example/foto.png'],
        mentions_owner: false,
        is_reply_to_owner: true,
      },
    ]);
  });
});
