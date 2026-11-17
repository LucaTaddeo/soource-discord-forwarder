import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildCleanContent, cleanDiscordSyntax } from '../src/content.js';

const maps = {
  users: new Map([
    ['10', 'Luca'],
    ['11', 'Ada'],
  ]),
  roles: new Map([['55', 'mod']]),
  channels: new Map([['200', 'generale']]),
};

describe('cleanDiscordSyntax', () => {
  it('replaces users, roles, channels, emoji, and slash commands', () => {
    const input = 'ciao <@10> <@!11> <@&55> <#200> <:wave:99> <a:party:98> </stats:77>';
    assert.equal(cleanDiscordSyntax(input, maps), 'ciao @Luca @Ada @mod #generale :wave: :party: /stats');
  });

  it('keeps a readable fallback when a mention cannot be resolved', () => {
    assert.equal(cleanDiscordSyntax('ciao <@123> <#456>', {}), 'ciao @123 #456');
  });

  it('can be called twice without the global regex getting stuck', () => {
    assert.equal(cleanDiscordSyntax('<@10>', maps), '@Luca');
    assert.equal(cleanDiscordSyntax('<@10>', maps), '@Luca');
  });

  it('leaves ordinary text alone', () => {
    assert.equal(cleanDiscordSyntax('  ciao\nmondo  '), '  ciao\nmondo  ');
  });
});

describe('buildCleanContent', () => {
  it('joins text, attachment URLs, and embed titles', () => {
    const content = buildCleanContent({
      content: '  foto  ',
      attachments: ['https://cdn.example/a.png', 'https://cdn.example/b.pdf'],
      embedTitles: ['Resoconto', '  '],
    });
    assert.equal(content, 'foto\n\nhttps://cdn.example/a.png\nhttps://cdn.example/b.pdf\n\nEmbed: Resoconto');
  });

  it('returns an empty string when there is nothing to send', () => {
    assert.equal(buildCleanContent({ content: '   ', attachments: [], embedTitles: [] }), '');
  });

  it('keeps attachments when the message text is empty', () => {
    assert.equal(buildCleanContent({ content: '', attachments: ['https://cdn.example/a.png'] }), 'https://cdn.example/a.png');
  });
});
