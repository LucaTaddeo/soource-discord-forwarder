import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { inspectMessage } from '../src/inspectMessage.js';
import { buildPayload } from '../src/payload.js';

function message(overrides = {}) {
  return {
    id: '900',
    content: 'ciao <@10> guarda <#200>',
    guildId: '100',
    channelId: '200',
    createdAt: new Date('2026-02-03T04:05:06.000Z'),
    url: 'https://discord.com/channels/100/200/900',
    author: { id: '30', username: 'ada', globalName: 'Ada Lovelace', bot: false },
    member: { displayName: 'Ada N.' },
    guild: { name: 'Soource' },
    channel: { name: 'generale', isDMBased: () => false },
    mentions: {
      users: new Map([['10', { id: '10', username: 'luca', globalName: 'Luca' }]]),
      roles: new Map(),
      channels: new Map([['200', { id: '200', name: 'generale' }]]),
      everyone: false,
      repliedUser: null,
    },
    attachments: new Map([['a', { url: 'https://cdn.example/foto.png' }]]),
    embeds: [{ title: 'Report' }, { title: '' }],
    reference: null,
    system: false,
    webhookId: null,
    ...overrides,
  };
}

describe('inspectMessage', () => {
  it('builds a guild payload with clean text, attachments, and embed titles', async () => {
    const inspected = await inspectMessage(message(), '10');
    const payload = buildPayload(inspected.payload);
    assert.equal(payload.server, 'Soource');
    assert.equal(payload.server_id, '100');
    assert.equal(payload.channel, 'generale');
    assert.equal(payload.author, 'Ada N.');
    assert.equal(payload.content, 'ciao @Luca guarda #generale\n\nhttps://cdn.example/foto.png\n\nEmbed: Report');
    assert.equal(payload.mentions_owner, true);
    assert.equal(payload.is_reply_to_owner, false);
    assert.equal(payload.is_dm, false);
    assert.equal(payload.created_at, '2026-02-03T04:05:06.000Z');
    assert.equal(inspected.filter.authorIsBot, false);
  });

  it('prefers the server nickname and falls back to the global name', async () => {
    const nick = await inspectMessage(message(), null);
    assert.equal(nick.payload.author, 'Ada N.');
    const globalName = await inspectMessage(message({ member: null }), null);
    assert.equal(globalName.payload.author, 'Ada Lovelace');
  });

  it('marks a direct message and does not look up guild roles', async () => {
    let fetched = 0;
    const inspected = await inspectMessage(
      message({
        guildId: null,
        guild: null,
        channelId: 'dm-1',
        channel: { isDMBased: () => true },
        url: '',
        content: '@everyone',
        mentions: { users: new Map(), roles: new Map(), everyone: true, repliedUser: null },
        attachments: new Map(),
        embeds: [],
      }),
      '10',
      {
        fetchOwnerMember: async () => {
          fetched += 1;
          return { roleIds: ['1'] };
        },
      },
    );
    assert.equal(fetched, 0);
    assert.equal(inspected.payload.isDm, true);
    assert.equal(inspected.payload.server, null);
    assert.equal(inspected.payload.channel, 'DM');
    assert.equal(inspected.payload.url, 'https://discord.com/channels/@me/dm-1/900');
    assert.equal(inspected.filter.mentionsOwner, false);
  });

  it('counts a reply to the owner separately from a direct mention', async () => {
    const inspected = await inspectMessage(
      message({
        content: 'rispondo',
        mentions: {
          users: new Map([['10', { id: '10', username: 'luca' }]]),
          roles: new Map(),
          everyone: false,
          repliedUser: { id: '10' },
        },
        reference: { messageId: '800', type: 0 },
        attachments: new Map(),
        embeds: [],
      }),
      '10',
    );
    assert.equal(inspected.filter.isReplyToOwner, true);
    assert.equal(inspected.filter.mentionsOwner, false);
  });

  it('loads the referenced message when Discord did not include it', async () => {
    let calls = 0;
    const inspected = await inspectMessage(
      message({
        content: 'rispondo',
        mentions: { users: new Map(), roles: new Map(), everyone: false, repliedUser: null },
        reference: { messageId: '800' },
        attachments: new Map(),
        embeds: [],
      }),
      '10',
      {
        fetchReference: async () => {
          calls += 1;
          return { author: { id: '10' } };
        },
      },
    );
    assert.equal(calls, 1);
    assert.equal(inspected.filter.isReplyToOwner, true);
  });

  it('ignores a deleted referenced message and a forwarded message', async () => {
    const missing = await inspectMessage(
      message({
        content: 'rispondo',
        mentions: { users: new Map(), roles: new Map(), everyone: false, repliedUser: null },
        reference: { messageId: '800', type: 0 },
        attachments: new Map(),
        embeds: [],
      }),
      '10',
      {
        fetchReference: async () => {
          throw new Error('Unknown Message');
        },
      },
    );
    assert.equal(missing.filter.isReplyToOwner, false);

    let fetched = 0;
    const forwarded = await inspectMessage(
      message({
        content: 'inoltrato',
        mentions: { users: new Map(), roles: new Map(), everyone: false, repliedUser: { id: '10' } },
        reference: { messageId: '800', type: 1 },
        attachments: new Map(),
        embeds: [],
      }),
      '10',
      {
        fetchReference: async () => {
          fetched += 1;
          return { author: { id: '10' } };
        },
      },
    );
    assert.equal(fetched, 0);
    assert.equal(forwarded.filter.isReplyToOwner, false);
    assert.equal(forwarded.filter.mentionsOwner, false);
  });

  it('detects a role mention from the raw text even if the role is not cached', async () => {
    let requested = null;
    const inspected = await inspectMessage(
      message({
        content: 'ciao <@&55>',
        mentions: { users: new Map(), roles: new Map(), everyone: false, repliedUser: null },
        attachments: new Map(),
        embeds: [],
      }),
      '10',
      {
        fetchOwnerMember: async (guildId, ownerId) => {
          requested = { guildId, ownerId };
          return { roleIds: ['1', '55'] };
        },
      },
    );
    assert.deepEqual(requested, { guildId: '100', ownerId: '10' });
    assert.equal(inspected.filter.mentionsOwner, true);
  });

  it('counts @everyone only when the owner is in the server', async () => {
    const base = message({
      content: '@everyone',
      mentions: { users: new Map(), roles: new Map(), everyone: true, repliedUser: null },
      attachments: new Map(),
      embeds: [],
    });
    const present = await inspectMessage(base, '10', {
      fetchOwnerMember: async () => ({ roleIds: ['100'] }),
    });
    const absent = await inspectMessage(base, '10', {
      fetchOwnerMember: async () => null,
    });
    assert.equal(present.filter.mentionsOwner, true);
    assert.equal(absent.filter.mentionsOwner, false);
  });

  it('does not fetch roles for a plain user mention', async () => {
    let fetched = 0;
    await inspectMessage(message(), '10', {
      fetchOwnerMember: async () => {
        fetched += 1;
        return { roleIds: [] };
      },
    });
    assert.equal(fetched, 0);
  });

  it('treats webhook authors as bots', async () => {
    const inspected = await inspectMessage(message({ webhookId: 'wh', author: { id: '99', username: 'hook', bot: false } }), null);
    assert.equal(inspected.filter.authorIsBot, true);
  });
});
