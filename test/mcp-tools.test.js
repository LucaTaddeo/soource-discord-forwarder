import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ChannelType } from 'discord.js';
import {
  BOT_ACTOR_PHRASE,
  READ_TOOL_NAMES,
  WRITE_TOOL_NAMES,
  createDiscordTools,
  invokeTool,
} from '../src/mcp/tools.js';

function message(overrides = {}) {
  return {
    id: '501',
    channelId: '301',
    guildId: '101',
    content: 'ciao @Ada',
    url: 'https://discord.com/channels/101/301/501',
    createdAt: new Date('2026-11-17T12:00:00.000Z'),
    createdTimestamp: Date.parse('2026-11-17T12:00:00.000Z'),
    editedAt: null,
    pinned: false,
    author: { id: '201', username: 'ada', globalName: 'Ada', bot: false },
    member: { displayName: 'Ada S.' },
    attachments: new Map([
      ['att', { id: 'att', name: 'foto.png', url: 'https://cdn.example/foto.png', contentType: 'image/png', size: 12 }],
    ]),
    reference: { messageId: '500', channelId: '301', guildId: '101' },
    ...overrides,
  };
}

function textChannel(overrides = {}) {
  return {
    id: '301',
    name: 'generale',
    type: ChannelType.GuildText,
    guildId: '101',
    parentId: null,
    isThread: () => false,
    isTextBased: () => true,
    messages: {
      fetch: async () => new Map([['501', message()]]),
    },
    send: async (payload) => message({ id: '900', content: payload.content, author: { id: 'bot', username: 'forwarder', bot: true } }),
    threads: {
      create: async () => ({ id: '801', name: 'topic', guildId: '101', parentId: '301' }),
    },
    ...overrides,
  };
}

function readyClient({ guilds = [], channels = [], users = [] } = {}) {
  const guildMap = new Map(guilds.map((guild) => [guild.id, guild]));
  const channelMap = new Map(channels.map((channel) => [channel.id, channel]));
  const userMap = new Map(users.map((user) => [user.id, user]));
  return {
    user: { id: 'bot' },
    isReady: () => true,
    guilds: {
      cache: guildMap,
      fetch: async (id) => (id ? guildMap.get(String(id)) ?? null : guildMap),
    },
    channels: {
      fetch: async (id) => channelMap.get(String(id)) ?? null,
    },
    users: {
      fetch: async (id) => {
        const user = userMap.get(String(id));
        if (!user) throw new Error('Unknown User');
        return user;
      },
    },
  };
}

function guild(id, name, extra = {}) {
  return {
    id,
    name,
    memberCount: 4,
    channels: {
      cache: new Map(),
      fetch: async () => {},
      fetchActiveThreads: async () => ({ threads: new Map() }),
    },
    members: { fetch: async () => new Map() },
    ...extra,
  };
}

function harness(client, config = {}) {
  const tools = createDiscordTools(client, { allowWrite: true, guildIds: null, ...config });
  const byName = new Map(tools.map((tool) => [tool.name, tool]));
  return {
    tools,
    async call(name, args) {
      const tool = byName.get(name);
      assert.ok(tool, `${name} è registrato`);
      return invokeTool(tool, args);
    },
  };
}

function data(result) {
  assert.notEqual(result.isError, true, result.content?.[0]?.text);
  return JSON.parse(result.content[0].text);
}

describe('Discord MCP tools', () => {
  it('registers read tools always and write tools only when ALLOW_WRITE is not false', () => {
    const client = readyClient();
    const enabled = createDiscordTools(client, { allowWrite: true, guildIds: null });
    const disabled = createDiscordTools(client, { allowWrite: false, guildIds: null });
    assert.deepEqual(
      enabled.map((tool) => tool.name),
      [...READ_TOOL_NAMES, ...WRITE_TOOL_NAMES],
    );
    assert.deepEqual(
      disabled.map((tool) => tool.name),
      READ_TOOL_NAMES,
    );
    for (const tool of enabled.filter((item) => !item.readOnly)) {
      assert.match(tool.description, /non come l'utente/);
      assert.ok(tool.description.includes(BOT_ACTOR_PHRASE));
    }
    for (const tool of enabled.filter((item) => item.readOnly)) {
      assert.equal(tool.description.includes(BOT_ACTOR_PHRASE), false);
    }
  });

  it('lists only the guilds in GUILD_IDS', async () => {
    const client = readyClient({
      guilds: [guild('101', 'Soource'), guild('102', 'Altro')],
    });
    const api = harness(client, { guildIds: new Set(['101']) });
    const body = data(await api.call('list_guilds', {}));
    assert.deepEqual(body.guilds, [{ id: '101', name: 'Soource', member_count: 4 }]);
  });

  it('lists channels and active threads, plus archived threads when asked', async () => {
    const archived = {
      id: '803',
      name: 'archivio',
      type: ChannelType.PublicThread,
      guildId: '101',
      parentId: '301',
      archived: true,
      isThread: () => true,
    };
    const active = {
      id: '802',
      name: 'dal vivo',
      type: ChannelType.PublicThread,
      guildId: '101',
      parentId: '301',
      archived: false,
      isThread: () => true,
    };
    let archivedCalls = 0;
    const parent = textChannel({
      threads: {
        fetchArchived: async (options) => {
          archivedCalls += 1;
          assert.equal(options.type, 'public');
          return { threads: new Map([[archived.id, archived]]) };
        },
      },
    });
    const server = guild('101', 'Soource');
    server.channels.cache.set(parent.id, parent);
    server.channels.fetchActiveThreads = async () => ({ threads: new Map([[active.id, active]]) });
    const client = readyClient({ guilds: [server] });
    const api = harness(client);

    const current = data(await api.call('list_channels', {}));
    assert.equal(archivedCalls, 0);
    assert.deepEqual(
      current.channels.map((channel) => channel.id),
      ['802', '301'],
    );
    assert.equal(current.channels.find((channel) => channel.id === '802').thread, true);

    const withArchived = data(await api.call('list_channels', { include_archived: true }));
    assert.equal(archivedCalls, 1);
    assert.ok(withArchived.channels.some((channel) => channel.id === '803' && channel.thread === true));
  });

  it('reads messages with author, timestamps, attachments, reply ref and url', async () => {
    let query;
    const channel = textChannel({
      messages: {
        fetch: async (options) => {
          query = options;
          return new Map([
            ['501', message()],
            ['499', message({ id: '499', content: 'prima', createdTimestamp: 1, createdAt: new Date(1), reference: null, attachments: new Map() })],
          ]);
        },
      },
    });
    const client = readyClient({ guilds: [guild('101', 'Soource')], channels: [channel] });
    const api = harness(client, { guildIds: new Set(['101']) });

    const page = data(await api.call('read_messages', { channel_id: '301', limit: 2, before: '600' }));
    assert.deepEqual(query, { limit: 2, before: '600' });
    assert.deepEqual(
      page.messages.map((item) => item.id),
      ['499', '501'],
    );
    const latest = page.messages[1];
    assert.deepEqual(latest.author, { id: '201', username: 'ada', display_name: 'Ada S.' });
    assert.equal(latest.content, 'ciao @Ada');
    assert.equal(latest.created_at, '2026-11-17T12:00:00.000Z');
    assert.equal(latest.edited_at, null);
    assert.deepEqual(latest.attachments, [
      { id: 'att', name: 'foto.png', url: 'https://cdn.example/foto.png', content_type: 'image/png', size: 12 },
    ]);
    assert.deepEqual(latest.reply_to, { message_id: '500', channel_id: '301', guild_id: '101' });
    assert.equal(latest.url, 'https://discord.com/channels/101/301/501');

    const around = await api.call('read_messages', { channel_id: '301', around: '501' });
    assert.equal(around.isError, undefined);
    assert.deepEqual(query, { limit: 50, around: '501' });

    const both = await api.call('read_messages', { channel_id: '301', before: '1', after: '2' });
    assert.equal(both.isError, true);
    assert.match(both.content[0].text, /uno solo/);

    const tooMany = await api.call('read_messages', { channel_id: '301', limit: 101 });
    assert.equal(tooMany.isError, true);
    assert.match(tooMany.content[0].text, /limit/);
  });

  it('rejects channels outside GUILD_IDS', async () => {
    let sent = false;
    const channel = textChannel({
      send: async () => {
        sent = true;
        return message();
      },
    });
    const client = readyClient({ channels: [channel], guilds: [guild('101', 'Soource'), guild('102', 'Altro')] });
    const api = harness(client, { guildIds: new Set(['102']) });
    const result = await api.call('get_message', { channel_id: '301', message_id: '501' });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /GUILD_IDS/);
    assert.equal(sent, false);
  });

  it('caps search to the requested pages and matches content or attachment names', async () => {
    let calls = 0;
    const channel = textChannel({
      messages: {
        fetch: async () => {
          calls += 1;
          const batch = new Map();
          for (let index = 0; index < 100; index += 1) {
            const id = `${calls}${String(index).padStart(3, '0')}`;
            batch.set(
              id,
              message({
                id,
                content: index === 0 ? 'qui c’è Keyword' : 'niente',
                createdTimestamp: 1_000_000 - calls * 1000 - index,
                attachments:
                  index === 1 ? new Map([['a', { id: 'a', name: 'keyword-file.txt', url: 'https://cdn.example/a', size: 1 }]]) : new Map(),
                reference: null,
              }),
            );
          }
          return batch;
        },
      },
    });
    const client = readyClient({ channels: [channel], guilds: [guild('101', 'Soource')] });
    const api = harness(client);
    const found = data(
      await api.call('search_messages', { channel_id: '301', keyword: 'keyword', max_pages: 2, limit: 10 }),
    );
    assert.equal(calls, 2);
    assert.equal(found.page_cap, 2);
    assert.equal(found.truncated, true);
    assert.equal(found.matches.length, 4);
    assert.ok(found.matches.some((item) => item.attachments[0]?.name === 'keyword-file.txt'));

    calls = 0;
    channel.messages.fetch = async () => {
      calls += 1;
      return new Map([['1', message({ id: '1', content: 'solo questa pagina', createdTimestamp: 10 })]]);
    };
    const short = data(await api.call('search_messages', { channel_ids: ['301'], keyword: 'questa', max_pages: 5 }));
    assert.equal(calls, 1);
    assert.equal(short.truncated, false);
    assert.equal(short.matches.length, 1);
  });

  it('sends, replies in a thread and creates threads as the bot', async () => {
    let sent;
    let threadSent;
    let started;
    let created;
    const thread = {
      id: '801',
      name: 'topic',
      guildId: '101',
      parentId: '301',
      isThread: () => true,
      isTextBased: () => true,
      send: async (payload) => {
        threadSent = payload;
        return message({ id: '901', channelId: '801', content: payload.content, author: { id: 'bot', username: 'forwarder', bot: true } });
      },
    };
    const channel = textChannel({
      send: async (payload) => {
        sent = payload;
        return message({ id: '900', content: payload.content, author: { id: 'bot', username: 'forwarder', bot: true } });
      },
      messages: {
        fetch: async (id) => message({ id, startThread: async (options) => {
          started = options;
          return thread;
        } }),
      },
      threads: {
        create: async (options) => {
          created = options;
          return thread;
        },
      },
    });
    const forum = textChannel({
      id: '302',
      name: 'forum',
      type: ChannelType.GuildForum,
      isTextBased: () => false,
      messages: undefined,
      send: undefined,
      threads: {
        create: async (options) => {
          created = options;
          return { id: '804', name: options.name, guildId: '101', parentId: '302' };
        },
      },
    });
    const client = readyClient({
      guilds: [guild('101', 'Soource')],
      channels: [channel, thread, forum],
    });
    const api = harness(client);

    const posted = data(await api.call('send_message', { channel_id: '301', content: 'ciao', reply_to_message_id: '500' }));
    assert.equal(posted.message.content, 'ciao');
    assert.equal(posted.message.author.id, 'bot');
    assert.deepEqual(sent.reply, { messageReference: '500', failIfNotExists: true });
    assert.deepEqual(sent.allowedMentions.parse, ['users', 'roles']);
    assert.equal(sent.allowedMentions.parse.includes('everyone'), false);

    const empty = await api.call('send_message', { channel_id: '301', content: '   ' });
    assert.equal(empty.isError, true);

    const replied = data(await api.call('reply_in_thread', { thread_id: '801', content: 'nel thread' }));
    assert.equal(replied.message.channel_id, '801');
    assert.equal(threadSent.content, 'nel thread');
    const notThread = await api.call('reply_in_thread', { thread_id: '301', content: 'no' });
    assert.equal(notThread.isError, true);

    created = undefined;
    const opened = data(
      await api.call('create_thread', { channel_id: '301', name: '  Nuovo topic  ', message_id: '501', content: 'primo' }),
    );
    assert.deepEqual(started, { name: 'Nuovo topic' });
    assert.equal(opened.thread.id, '801');
    assert.equal(opened.message.content, 'primo');

    created = undefined;
    threadSent = undefined;
    await api.call('create_thread', { channel_id: '301', name: 'senza messaggio', auto_archive_duration: 1440 });
    assert.equal(created.type, ChannelType.PublicThread);
    assert.equal(created.autoArchiveDuration, 1440);
    assert.equal(threadSent, undefined);

    const forumMissing = await api.call('create_thread', { channel_id: '302', name: 'post' });
    assert.equal(forumMissing.isError, true);
    created = undefined;
    const forumThread = data(await api.call('create_thread', { channel_id: '302', name: 'post', content: 'apertura' }));
    assert.equal(created.message.content, 'apertura');
    assert.equal(forumThread.thread.id, '804');
  });

  it('adds and removes only the bot reaction', async () => {
    let reacted;
    let removed;
    const channel = textChannel({
      messages: {
        fetch: async () =>
          message({
            react: async (emoji) => {
              reacted = emoji;
            },
            reactions: {
              resolve: () => null,
              fetch: async () => ({
                resolve: () => ({ users: { remove: async (userId) => {
                  removed = userId;
                } } }),
              }),
            },
          }),
      },
    });
    const client = readyClient({ channels: [channel], guilds: [guild('101', 'Soource')] });
    const api = harness(client);
    const added = data(await api.call('add_reaction', { channel_id: '301', message_id: '501', emoji: '<:wave:55>' }));
    assert.equal(reacted, '<:wave:55>');
    assert.equal(added.emoji, '<:wave:55>');
    const cleared = data(await api.call('remove_reaction', { channel_id: '301', message_id: '501', emoji: '👍' }));
    assert.equal(removed, 'bot');
    assert.equal(cleared.removed, true);
  });

  it('edits and deletes only the bot’s own messages, and pins any visible message', async () => {
    const calls = [];
    const foreign = message({
      edit: async () => {
        calls.push('edit');
      },
      delete: async () => {
        calls.push('delete');
      },
      pin: async () => {
        calls.push('pin');
      },
      unpin: async () => {
        calls.push('unpin');
      },
    });
    const own = message({
      id: '502',
      author: { id: 'bot', username: 'forwarder', bot: true },
      edit: async (payload) => message({ ...own, content: payload.content }),
      delete: async () => {
        calls.push('delete-own');
      },
    });
    const byId = new Map([
      ['501', foreign],
      ['502', own],
    ]);
    const channel = textChannel({
      messages: { fetch: async (id) => byId.get(id) },
    });
    const client = readyClient({ channels: [channel], guilds: [guild('101', 'Soource')] });
    const api = harness(client);

    const editBlocked = await api.call('edit_message', { channel_id: '301', message_id: '501', content: 'no' });
    const deleteBlocked = await api.call('delete_message', { channel_id: '301', message_id: '501' });
    assert.equal(editBlocked.isError, true);
    assert.equal(deleteBlocked.isError, true);
    assert.deepEqual(calls, []);

    const edited = data(await api.call('edit_message', { channel_id: '301', message_id: '502', content: 'aggiornato' }));
    assert.equal(edited.message.content, 'aggiornato');
    const deleted = data(await api.call('delete_message', { channel_id: '301', message_id: '502' }));
    assert.deepEqual(deleted, { deleted: true, id: '502', channel_id: '301' });
    assert.deepEqual(calls, ['delete-own']);

    const pinned = data(await api.call('pin_message', { channel_id: '301', message_id: '501' }));
    const unpinned = data(await api.call('unpin_message', { channel_id: '301', message_id: '501' }));
    assert.equal(pinned.pinned, true);
    assert.equal(unpinned.pinned, false);
    assert.deepEqual(calls, ['delete-own', 'pin', 'unpin']);
  });

  it('lists and reads members inside the allowed guild', async () => {
    let memberQuery;
    const member = {
      id: '201',
      nickname: 'Ada',
      displayName: 'Ada S.',
      joinedAt: new Date('2026-01-02T00:00:00.000Z'),
      user: { id: '201', username: 'ada', globalName: 'Ada', bot: false },
      roles: {
        cache: new Map([
          ['1', { id: '1', name: '@everyone' }],
          ['2', { id: '2', name: 'team' }],
        ]),
      },
    };
    const server = guild('101', 'Soource', {
      members: {
        fetch: async (options) => {
          memberQuery = options;
          if (typeof options === 'string') return member;
          return new Map([[member.id, member]]);
        },
      },
    });
    const client = readyClient({ guilds: [server, guild('102', 'Altro')] });
    const api = harness(client, { guildIds: new Set(['101']) });
    const denied = await api.call('get_member', { guild_id: '102', user_id: '201' });
    assert.equal(denied.isError, true);

    const one = data(await api.call('get_member', { guild_id: '101', user_id: '201' }));
    assert.equal(one.member.display_name, 'Ada S.');
    assert.deepEqual(one.member.roles, [{ id: '2', name: 'team' }]);
    assert.equal(one.member.joined_at, '2026-01-02T00:00:00.000Z');

    const many = data(await api.call('list_members', { guild_id: '101', query: 'ad', limit: 5 }));
    assert.deepEqual(memberQuery, { query: 'ad', limit: 5 });
    assert.equal(many.members.length, 1);
  });

  it('sends a DM only when the user belongs to an allowed guild', async () => {
    let fetchedUser = false;
    const user = {
      id: '201',
      send: async (payload) => message({ id: '950', guildId: null, channelId: '401', content: payload.content, url: 'https://discord.com/channels/@me/401/950' }),
    };
    const allowed = guild('101', 'Soource', {
      members: {
        fetch: async (id) => {
          if (id === '201') return { id };
          throw new Error('Unknown Member');
        },
      },
    });
    const client = readyClient({ guilds: [allowed], users: [user] });
    client.users.fetch = async (id) => {
      fetchedUser = true;
      if (id !== '201') throw new Error('Unknown User');
      return user;
    };
    const blocked = harness(client, { guildIds: new Set(['101']) });
    const missing = await blocked.call('send_dm', { user_id: '999', content: 'ciao' });
    assert.equal(missing.isError, true);
    assert.equal(fetchedUser, false);

    const sent = data(await blocked.call('send_dm', { user_id: '201', content: 'ciao dal bot' }));
    assert.equal(fetchedUser, true);
    assert.equal(sent.message.content, 'ciao dal bot');
    assert.equal(sent.message.url, 'https://discord.com/channels/@me/401/950');
  });

  it('refuses every tool until the Discord client is ready', async () => {
    const client = readyClient({ guilds: [guild('101', 'Soource')] });
    client.isReady = () => false;
    const api = harness(client);
    const result = await api.call('list_guilds', {});
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /non è ancora connesso/);
  });
});
