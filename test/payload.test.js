import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PAYLOAD_FIELDS, buildPayload, samplePayload } from '../src/payload.js';

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
    assert.deepEqual(Object.keys(sample), PAYLOAD_FIELDS);
    assert.equal(sample.created_at, '2026-04-01T00:00:00.000Z');
    assert.equal(sample.is_dm, false);
    assert.equal(typeof sample.content, 'string');
    assert.ok(sample.content.length > 0);
  });
});
