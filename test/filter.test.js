import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  computeMentionsOwner,
  directUserMentionIds,
  inScope,
  roleMentionIds,
  shouldForward,
} from '../src/filter.js';

function config(overrides = {}) {
  return {
    ownerUserId: '10',
    guildIds: null,
    channelIds: null,
    forwardMode: 'all',
    ...overrides,
  };
}

function message(overrides = {}) {
  return {
    authorIsBot: false,
    system: false,
    authorId: '20',
    guildId: '100',
    channelId: '200',
    isDm: false,
    mentionsOwner: false,
    isReplyToOwner: false,
    incomplete: false,
    ...overrides,
  };
}

describe('shouldForward', () => {
  it('drops messages from bots, including the bot itself', () => {
    assert.deepEqual(shouldForward(message({ authorIsBot: true }), config()), {
      forward: false,
      reason: 'bot',
    });
  });

  it('drops system messages', () => {
    assert.equal(shouldForward(message({ system: true }), config()).reason, 'system');
  });

  it('drops messages written by the owner', () => {
    const result = shouldForward(message({ authorId: '10', mentionsOwner: true, isDm: true }), config());
    assert.equal(result.forward, false);
    assert.equal(result.reason, 'owner');
  });

  it('forwards a normal guild message in mode all', () => {
    assert.equal(shouldForward(message(), config()).forward, true);
  });

  it('keeps only the configured guilds and still lets DMs through', () => {
    const guildIds = new Set(['100']);
    assert.equal(shouldForward(message({ guildId: '999' }), config({ guildIds })).reason, 'guild');
    assert.equal(shouldForward(message({ guildId: '100' }), config({ guildIds })).forward, true);
    assert.equal(
      shouldForward(message({ isDm: true, guildId: null, channelId: 'dm-1' }), config({ guildIds })).forward,
      true,
    );
  });

  it('keeps only the configured channels and still lets DMs through', () => {
    const channelIds = new Set(['200']);
    assert.equal(shouldForward(message({ channelId: '201' }), config({ channelIds })).reason, 'channel');
    assert.equal(shouldForward(message({ channelId: '200' }), config({ channelIds })).forward, true);
    assert.equal(
      shouldForward(message({ isDm: true, guildId: null, channelId: 'not-listed' }), config({ channelIds })).forward,
      true,
    );
  });

  it('requires both guild and channel when both filters are set', () => {
    const filters = config({ guildIds: new Set(['100']), channelIds: new Set(['200']) });
    assert.equal(shouldForward(message({ guildId: '100', channelId: '201' }), filters).reason, 'channel');
    assert.equal(shouldForward(message({ guildId: '999', channelId: '200' }), filters).reason, 'guild');
    assert.equal(shouldForward(message(), filters).forward, true);
  });

  it('in mentions mode forwards mentions, replies to the owner, and DMs', () => {
    const filters = config({ forwardMode: 'mentions' });
    assert.equal(shouldForward(message(), filters).reason, 'mode');
    assert.equal(shouldForward(message({ mentionsOwner: true }), filters).forward, true);
    assert.equal(shouldForward(message({ isReplyToOwner: true }), filters).forward, true);
    assert.equal(shouldForward(message({ isDm: true, guildId: null }), filters).forward, true);
  });

  it('in mentions mode still forwards DMs when the owner id is unset', () => {
    const filters = config({ ownerUserId: null, forwardMode: 'mentions' });
    assert.equal(shouldForward(message(), filters).reason, 'mode');
    assert.equal(shouldForward(message({ isDm: true, guildId: null }), filters).forward, true);
  });

  it('does not apply mentions mode inside inScope', () => {
    const result = inScope(message(), config({ forwardMode: 'mentions' }));
    assert.equal(result.ok, true);
  });

  it('rejects a message without an author or channel', () => {
    assert.equal(shouldForward(message({ authorId: '' }), config()).reason, 'incomplete');
    assert.equal(shouldForward(message({ channelId: '' }), config()).reason, 'incomplete');
  });
});

describe('mention detection', () => {
  it('does not treat the replied-to user as a direct mention', () => {
    assert.deepEqual(directUserMentionIds('ciao', ['10'], '10'), []);
    assert.deepEqual(directUserMentionIds('ciao <@10>', ['10'], '10'), ['10']);
    assert.deepEqual(directUserMentionIds('ciao <@!10> e <@11>', [], null), ['10', '11']);
  });

  it('reads role mentions from the text and from the API list', () => {
    assert.deepEqual(roleMentionIds('hey <@&55>', ['56']), ['55', '56']);
    assert.deepEqual(roleMentionIds('no roles', []), []);
  });

  it('does not treat a role mention as a user mention', () => {
    assert.deepEqual(directUserMentionIds('<@&55>', [], null), []);
  });

  it('computes mentions_owner from a user, a role, or @everyone', () => {
    assert.equal(computeMentionsOwner({ ownerUserId: null, mentionedUserIds: ['10'] }), false);
    assert.equal(computeMentionsOwner({ ownerUserId: '10', mentionedUserIds: ['10'] }), true);
    assert.equal(computeMentionsOwner({ ownerUserId: '10', mentionedUserIds: ['11'] }), false);
    assert.equal(
      computeMentionsOwner({ ownerUserId: '10', mentionedRoleIds: ['55'], ownerRoleIds: [55] }),
      true,
    );
    assert.equal(
      computeMentionsOwner({ ownerUserId: '10', mentionedRoleIds: ['55'], ownerRoleIds: ['56'] }),
      false,
    );
    assert.equal(computeMentionsOwner({ ownerUserId: '10', mentionsEveryone: true }), true);
  });
});
