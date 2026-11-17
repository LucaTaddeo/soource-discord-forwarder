import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { GatewayIntentBits, Partials } from 'discord.js';
import { DISCORD_CLIENT_OPTIONS, buildClientOptions } from '../src/index.js';

describe('Discord client options', () => {
  it('requests the gateway intents and the DM channel partial', () => {
    assert.deepEqual(DISCORD_CLIENT_OPTIONS.intents, [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.DirectMessages,
    ]);
    assert.deepEqual(DISCORD_CLIENT_OPTIONS.partials, [Partials.Channel]);
  });

  it('requests Guild Members only when the MCP server is enabled', () => {
    assert.equal(buildClientOptions(false), DISCORD_CLIENT_OPTIONS);
    const enabled = buildClientOptions(true);
    assert.ok(enabled.intents.includes(GatewayIntentBits.GuildMembers));
    assert.equal(enabled.intents.length, DISCORD_CLIENT_OPTIONS.intents.length + 1);
    assert.equal(DISCORD_CLIENT_OPTIONS.intents.includes(GatewayIntentBits.GuildMembers), false);
    assert.deepEqual(enabled.partials, DISCORD_CLIENT_OPTIONS.partials);
  });
});
