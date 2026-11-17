import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { GatewayIntentBits, Partials } from 'discord.js';
import { DISCORD_CLIENT_OPTIONS } from '../src/index.js';

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
});
