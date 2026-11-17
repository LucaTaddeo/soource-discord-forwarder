import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { describeWebhookUrl, loadConfig, loadWebhookConfig, parseIdList } from '../src/config.js';

const SECRET_TOKEN = 'super-secret-token-value';
const SECRET_AUTH = 'Bearer super-secret-auth-value';

function env(overrides = {}) {
  return {
    DISCORD_TOKEN: SECRET_TOKEN,
    WEBHOOK_URL: 'https://hooks.example.test/inbound/abc',
    WEBHOOK_AUTHORIZATION: SECRET_AUTH,
    ...overrides,
  };
}

describe('parseIdList', () => {
  it('returns null when the filter is unset or blank', () => {
    assert.equal(parseIdList(undefined), null);
    assert.equal(parseIdList(''), null);
    assert.equal(parseIdList(' , , '), null);
  });

  it('trims ids and accepts mention wrappers', () => {
    assert.deepEqual(parseIdList(' 111, <@222>, <#333>, <@&444> '), new Set(['111', '222', '333', '444']));
  });
});

describe('loadConfig', () => {
  it('requires the three secrets and defaults the mode to all', () => {
    const config = loadConfig(env());
    assert.equal(config.token, SECRET_TOKEN);
    assert.equal(config.authorization, SECRET_AUTH);
    assert.equal(config.forwardMode, 'all');
    assert.equal(config.ownerUserId, null);
    assert.equal(config.guildIds, null);
    assert.equal(config.channelIds, null);
  });

  it('normalizes an optional owner mention and accepts mentions mode', () => {
    const config = loadConfig(
      env({
        OWNER_USER_ID: '<@!42>',
        GUILD_IDS: '100',
        CHANNEL_IDS: '<#200>',
        FORWARD_MODE: ' Mentions ',
      }),
    );
    assert.equal(config.ownerUserId, '42');
    assert.deepEqual(config.guildIds, new Set(['100']));
    assert.deepEqual(config.channelIds, new Set(['200']));
    assert.equal(config.forwardMode, 'mentions');
  });

  it('lists every missing variable and does not echo the secrets', () => {
    assert.throws(() => loadConfig({}), /DISCORD_TOKEN, WEBHOOK_URL, WEBHOOK_AUTHORIZATION/);
    assert.throws(
      () => loadConfig({ DISCORD_TOKEN: SECRET_TOKEN, WEBHOOK_AUTHORIZATION: SECRET_AUTH }),
      (error) => {
        assert.match(error.message, /WEBHOOK_URL/);
        assert.equal(error.message.includes(SECRET_TOKEN), false);
        assert.equal(error.message.includes(SECRET_AUTH), false);
        return true;
      },
    );
  });

  it('rejects a bad url or mode', () => {
    assert.throws(() => loadConfig(env({ WEBHOOK_URL: 'non è un url' })), /WEBHOOK_URL non è un URL valido/);
    assert.throws(() => loadConfig(env({ WEBHOOK_URL: 'ftp://example.test/hook' })), /http o https/);
    assert.throws(() => loadConfig(env({ FORWARD_MODE: 'everything' })), /FORWARD_MODE/);
  });

  it('describes the webhook by origin only', () => {
    assert.equal(describeWebhookUrl('https://user:pass@hooks.example.test/secret/path?token=1'), 'https://hooks.example.test');
  });
});

describe('loadWebhookConfig', () => {
  it('does not require the Discord token', () => {
    const webhook = loadWebhookConfig({
      WEBHOOK_URL: 'http://127.0.0.1:9/hook',
      WEBHOOK_AUTHORIZATION: 'Token plain-value',
    });
    assert.equal(webhook.webhookUrl, 'http://127.0.0.1:9/hook');
    assert.equal(webhook.authorization, 'Token plain-value');
  });
});
