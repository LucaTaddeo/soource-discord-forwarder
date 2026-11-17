import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { evaluateMessage } from '../src/evaluate.js';
import { PAYLOAD_FIELDS } from '../src/payload.js';

function config(overrides = {}) {
  return {
    ownerUserId: '10',
    guildIds: new Set(['100']),
    channelIds: new Set(['200']),
    forwardMode: 'all',
    ...overrides,
  };
}

function message(overrides = {}) {
  return {
    id: '900',
    content: 'ciao a tutti',
    guildId: '100',
    channelId: '200',
    createdAt: new Date('2026-02-03T04:05:06.000Z'),
    url: 'https://discord.com/channels/100/200/900',
    author: { id: '30', username: 'ada', globalName: 'Ada', bot: false },
    member: { displayName: 'Ada' },
    guild: { name: 'Soource' },
    channel: { name: 'generale', isDMBased: () => false },
    mentions: { users: new Map(), roles: new Map(), everyone: false, repliedUser: null },
    attachments: new Map(),
    embeds: [],
    reference: null,
    system: false,
    ...overrides,
  };
}

describe('evaluateMessage', () => {
  it('does not resolve mentions for a bot or a filtered-out channel', async () => {
    let lookups = 0;
    const options = {
      fetchReference: async () => {
        lookups += 1;
        return null;
      },
      fetchOwnerMember: async () => {
        lookups += 1;
        return null;
      },
    };

    const bot = await evaluateMessage(
      message({ author: { id: '1', username: 'bot', bot: true }, content: '<@10>' }),
      config(),
      options,
    );
    const otherChannel = await evaluateMessage(message({ channelId: '999', content: '<@&5>' }), config(), options);

    assert.equal(bot.forward, false);
    assert.equal(bot.reason, 'bot');
    assert.equal(bot.payload, null);
    assert.equal(otherChannel.reason, 'channel');
    assert.equal(lookups, 0);
  });

  it('forwards an in-scope message with the public payload shape', async () => {
    const decision = await evaluateMessage(message(), config());
    assert.equal(decision.forward, true);
    assert.deepEqual(Object.keys(decision.payload), PAYLOAD_FIELDS);
    assert.equal(decision.payload.author, 'Ada');
    assert.equal(decision.payload.server, 'Soource');
    assert.equal(decision.payload.mentions_owner, false);
    assert.equal(decision.entry.key, '200');
    assert.equal(decision.entry.author, 'Ada');
    assert.equal(decision.entry.channelId, '200');
  });

  it('drops a plain message in mentions mode after checking it', async () => {
    const decision = await evaluateMessage(message(), config({ forwardMode: 'mentions' }));
    assert.equal(decision.forward, false);
    assert.equal(decision.reason, 'mode');
  });

  it('forwards a role mention in mentions mode', async () => {
    const decision = await evaluateMessage(
      message({ content: 'ping <@&55>' }),
      config({ forwardMode: 'mentions' }),
      { fetchOwnerMember: async () => ({ roleIds: ['55'] }) },
    );
    assert.equal(decision.forward, true);
    assert.equal(decision.payload.mentions_owner, true);
    assert.equal(decision.payload.content, 'ping @55');
  });

  it('forwards a DM even when guild and channel filters are set', async () => {
    const decision = await evaluateMessage(
      message({
        guildId: null,
        guild: null,
        channelId: 'dm-9',
        channel: { name: null, isDMBased: () => true },
        content: 'ciao dal privato',
      }),
      config(),
    );
    assert.equal(decision.forward, true);
    assert.equal(decision.payload.is_dm, true);
    assert.equal(decision.payload.server, null);
    assert.equal(decision.payload.channel, 'DM');
  });
});
