import { ChannelType } from 'discord.js';
import { z } from 'zod';
import { redact } from '../log.js';
import {
  listOf,
  serializeChannel,
  serializeMember,
  serializeMessage,
  serializeThread,
} from './serialize.js';

export const BOT_ACTOR_PHRASE =
  "Questa azione è eseguita dall'account del bot, non come l'utente.";

export const READ_TOOL_NAMES = [
  'list_guilds',
  'list_channels',
  'read_messages',
  'search_messages',
  'get_message',
  'list_members',
  'get_member',
];

export const WRITE_TOOL_NAMES = [
  'send_message',
  'reply_in_thread',
  'create_thread',
  'add_reaction',
  'remove_reaction',
  'edit_message',
  'delete_message',
  'pin_message',
  'unpin_message',
  'send_dm',
];

const SEARCH_PAGE_SIZE = 100;
const ARCHIVED_PARENT_CAP = 25;
const ARCHIVED_PER_PARENT = 50;
const ARCHIVE_MINUTES = new Set([60, 1440, 4320, 10080]);
const MENTIONS = { parse: ['users', 'roles'], repliedUser: false };

const snowflake = z
  .string()
  .regex(/^\d{1,20}$/)
  .describe('ID Discord numerico');

const readAnnotations = { readOnlyHint: true, destructiveHint: false, openWorldHint: true };
const writeAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: true,
};

export class ToolError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ToolError';
  }
}

function textResult(data) {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

function errorResult(error) {
  const message = error instanceof Error ? error.message : String(error);
  return { content: [{ type: 'text', text: redact(message) }], isError: true };
}

export async function invokeTool(tool, args) {
  try {
    return textResult(await tool.handler(args ?? {}));
  } catch (error) {
    return errorResult(error);
  }
}

function assertReady(client) {
  const ready = typeof client.isReady === 'function' ? client.isReady() : Boolean(client.user);
  if (!ready || !client.user?.id) {
    throw new ToolError('Il bot non è ancora connesso a Discord');
  }
}

function assertWrite(config) {
  if (config.allowWrite === false) {
    throw new ToolError('Scrittura disattivata (ALLOW_WRITE=false)');
  }
}

function requireSnowflake(value, field) {
  if (typeof value !== 'string' || !/^\d{1,20}$/.test(value)) {
    throw new ToolError(`${field} deve essere un ID Discord numerico`);
  }
  return value;
}

function optionalSnowflake(value, field) {
  if (value == null || value === '') return null;
  return requireSnowflake(value, field);
}

function requireContent(value) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ToolError('content è obbligatorio');
  }
  if (value.length > 2000) {
    throw new ToolError('content supera i 2000 caratteri');
  }
  return value;
}

function optionalInt(value, { min, max, fallback, field }) {
  if (value == null) return fallback;
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new ToolError(`${field} deve essere un intero tra ${min} e ${max}`);
  }
  return value;
}

function requireThreadName(value) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ToolError('name è obbligatorio');
  }
  const name = value.trim();
  if (name.length > 100) throw new ToolError('name supera i 100 caratteri');
  return name;
}

function optionalArchive(value) {
  if (value == null || value === '') return undefined;
  if (!ARCHIVE_MINUTES.has(value)) {
    throw new ToolError('auto_archive_duration deve essere 60, 1440, 4320 o 10080');
  }
  return value;
}

function requireEmoji(value) {
  if (typeof value !== 'string' || value.trim() === '' || value.length > 100) {
    throw new ToolError('emoji non valida');
  }
  return value.trim();
}

function guildAllowed(config, guildId) {
  if (!config.guildIds) return true;
  return config.guildIds.has(String(guildId));
}

function visibleGuilds(client, config) {
  const guilds = [...client.guilds.cache.values()];
  const filtered = config.guildIds
    ? guilds.filter((guild) => config.guildIds.has(String(guild.id)))
    : guilds;
  return filtered.sort((left, right) => String(left.name).localeCompare(String(right.name), 'it'));
}

async function resolveGuild(client, config, guildId) {
  assertReady(client);
  if (guildId == null || guildId === '') {
    const visible = visibleGuilds(client, config);
    if (visible.length === 1) return visible[0];
    if (visible.length === 0) throw new ToolError('Nessun server visibile al bot');
    throw new ToolError('Indica guild_id: il bot è in più di un server');
  }
  const id = requireSnowflake(guildId, 'guild_id');
  if (!guildAllowed(config, id)) throw new ToolError('Server fuori da GUILD_IDS');
  let guild = client.guilds.cache.get(id) ?? null;
  if (!guild && typeof client.guilds.fetch === 'function') {
    try {
      guild = await client.guilds.fetch(id);
    } catch (error) {
      throw new ToolError(`Server non trovato: ${error.message}`);
    }
  }
  if (!guild) throw new ToolError('Server non trovato');
  if (!guildAllowed(config, guild.id)) throw new ToolError('Server fuori da GUILD_IDS');
  return guild;
}

async function requireChannel(client, config, channelId, field = 'channel_id') {
  assertReady(client);
  const id = requireSnowflake(channelId, field);
  let channel;
  try {
    channel = await client.channels.fetch(id);
  } catch (error) {
    throw new ToolError(`Canale non trovato: ${error.message}`);
  }
  if (!channel) throw new ToolError('Canale non trovato');
  const guildId = channel.guildId ?? channel.guild?.id ?? null;
  if (guildId) {
    if (!guildAllowed(config, guildId)) {
      throw new ToolError('Canale fuori dai server consentiti da GUILD_IDS');
    }
    return channel;
  }
  if (config.guildIds) {
    throw new ToolError('Canale fuori dai server consentiti da GUILD_IDS');
  }
  return channel;
}

function assertTextChannel(channel) {
  if (typeof channel.isTextBased === 'function' && !channel.isTextBased()) {
    throw new ToolError('Il canale non accetta messaggi di testo');
  }
  if (typeof channel.isTextBased !== 'function' && !channel.messages && typeof channel.send !== 'function') {
    throw new ToolError('Il canale non accetta messaggi di testo');
  }
}

async function requireTextChannel(client, config, channelId, field = 'channel_id') {
  const channel = await requireChannel(client, config, channelId, field);
  assertTextChannel(channel);
  return channel;
}

function discordFailure(error, action) {
  if (error instanceof ToolError) throw error;
  const message = error instanceof Error ? error.message : String(error);
  throw new ToolError(`${action}: ${message}`);
}

function outgoing(content, replyToMessageId) {
  const payload = { content, allowedMentions: MENTIONS };
  if (replyToMessageId) {
    payload.reply = { messageReference: replyToMessageId, failIfNotExists: true };
  }
  return payload;
}

function isOwnMessage(client, message) {
  const botId = client.user?.id;
  const authorId = message.author?.id;
  if (!botId || !authorId) return false;
  return String(botId) === String(authorId);
}

async function fetchMessage(client, config, args) {
  const channel = await requireTextChannel(client, config, args.channel_id);
  const messageId = requireSnowflake(args.message_id, 'message_id');
  if (!channel.messages || typeof channel.messages.fetch !== 'function') {
    throw new ToolError('Il canale non accetta messaggi di testo');
  }
  try {
    const message = await channel.messages.fetch(messageId);
    if (!message || typeof message === 'object' && typeof message.values === 'function') {
      throw new ToolError('Messaggio non trovato');
    }
    return { channel, message };
  } catch (error) {
    discordFailure(error, 'Lettura del messaggio');
  }
}

function messageMatches(message, needle) {
  if (String(message.content ?? '').toLowerCase().includes(needle)) return true;
  return listOf(message.attachments).some((attachment) =>
    String(attachment.name ?? '').toLowerCase().includes(needle),
  );
}

function isForumChannel(channel) {
  return channel.type === ChannelType.GuildForum || channel.type === ChannelType.GuildMedia;
}

async function listGuilds(client, config) {
  assertReady(client);
  if (typeof client.guilds.fetch === 'function') {
    try {
      await client.guilds.fetch();
    } catch {
      // The ready cache is enough when the gateway list cannot be refreshed.
    }
  }
  return {
    guilds: visibleGuilds(client, config).map((guild) => ({
      id: guild.id,
      name: guild.name,
      member_count: guild.memberCount ?? null,
    })),
  };
}

async function listChannels(client, config, args) {
  const guild = await resolveGuild(client, config, args.guild_id);
  if (args.include_archived != null && typeof args.include_archived !== 'boolean') {
    throw new ToolError('include_archived deve essere true o false');
  }
  if (typeof guild.channels?.fetch === 'function') {
    try {
      await guild.channels.fetch();
    } catch (error) {
      throw new ToolError(`Impossibile leggere i canali: ${error.message}`);
    }
  }
  if (!guild.channels?.cache) throw new ToolError('Impossibile leggere i canali');

  const byId = new Map();
  for (const channel of guild.channels.cache.values()) {
    byId.set(channel.id, serializeChannel(channel));
  }

  let threadsWarning = null;
  if (typeof guild.channels?.fetchActiveThreads === 'function') {
    try {
      const active = await guild.channels.fetchActiveThreads();
      for (const thread of listOf(active?.threads)) {
        byId.set(thread.id, serializeChannel(thread));
      }
    } catch (error) {
      threadsWarning = `Thread attivi non letti: ${error.message}`;
    }
  }

  if (args.include_archived === true) {
    const parents = [...guild.channels.cache.values()]
      .filter((channel) => typeof channel.threads?.fetchArchived === 'function' && !channel.isThread?.())
      .slice(0, ARCHIVED_PARENT_CAP);
    for (const parent of parents) {
      try {
        const archived = await parent.threads.fetchArchived({ type: 'public', limit: ARCHIVED_PER_PARENT });
        for (const thread of listOf(archived?.threads)) {
          byId.set(thread.id, serializeChannel(thread));
        }
      } catch (error) {
        if (!threadsWarning) threadsWarning = `Alcuni thread archiviati non sono stati letti: ${error.message}`;
      }
    }
  }

  const channels = [...byId.values()].sort(
    (left, right) => String(left.name).localeCompare(String(right.name), 'it') || String(left.id).localeCompare(String(right.id)),
  );
  return {
    guild_id: guild.id,
    channels,
    ...(threadsWarning ? { threads_warning: threadsWarning } : {}),
  };
}

async function readMessages(client, config, args) {
  const channel = await requireTextChannel(client, config, args.channel_id);
  const limit = optionalInt(args.limit, { min: 1, max: 100, fallback: 50, field: 'limit' });
  const cursors = ['before', 'after', 'around'].filter((key) => args[key] != null && args[key] !== '');
  if (cursors.length > 1) throw new ToolError('Indica uno solo tra before, after e around');
  const query = { limit };
  if (cursors.length === 1) query[cursors[0]] = requireSnowflake(args[cursors[0]], cursors[0]);
  let fetched;
  try {
    fetched = await channel.messages.fetch(query);
  } catch (error) {
    discordFailure(error, 'Lettura dei messaggi');
  }
  const messages = listOf(fetched)
    .sort((left, right) => (left.createdTimestamp ?? 0) - (right.createdTimestamp ?? 0))
    .map(serializeMessage);
  return { channel_id: channel.id, messages };
}

async function searchMessages(client, config, args) {
  const ids = [];
  if (args.channel_id != null && args.channel_id !== '') ids.push(args.channel_id);
  if (Array.isArray(args.channel_ids)) ids.push(...args.channel_ids);
  const channelIds = [...new Set(ids)];
  if (channelIds.length === 0) throw new ToolError('Indica channel_id o channel_ids');
  if (channelIds.length > 10) throw new ToolError('Puoi cercare in al massimo 10 canali');
  for (const id of channelIds) requireSnowflake(id, 'channel_id');

  if (typeof args.keyword !== 'string' || args.keyword.trim() === '') {
    throw new ToolError('keyword è obbligatoria');
  }
  const keyword = args.keyword.trim();
  if (keyword.length > 200) throw new ToolError('keyword supera i 200 caratteri');
  const maxPages = optionalInt(args.max_pages, { min: 1, max: 10, fallback: 3, field: 'max_pages' });
  const limit = optionalInt(args.limit, { min: 1, max: 100, fallback: 25, field: 'limit' });
  const needle = keyword.toLowerCase();

  const matches = [];
  const seen = new Set();
  let scanned = 0;
  let truncated = false;

  for (const channelId of channelIds) {
    const channel = await requireTextChannel(client, config, channelId);
    let before;
    for (let page = 0; page < maxPages; page += 1) {
      const query = { limit: SEARCH_PAGE_SIZE };
      if (before) query.before = before;
      let fetched;
      try {
        fetched = await channel.messages.fetch(query);
      } catch (error) {
        discordFailure(error, 'Ricerca dei messaggi');
      }
      const ordered = listOf(fetched).sort(
        (left, right) => (right.createdTimestamp ?? 0) - (left.createdTimestamp ?? 0),
      );
      if (ordered.length === 0) break;
      for (const message of ordered) {
        if (seen.has(message.id)) continue;
        seen.add(message.id);
        scanned += 1;
        if (!messageMatches(message, needle)) continue;
        matches.push(serializeMessage(message));
        if (matches.length >= limit) {
          return {
            keyword,
            matches,
            scanned_messages: scanned,
            page_cap: maxPages,
            truncated: true,
          };
        }
      }
      const oldest = ordered[ordered.length - 1];
      if (!oldest?.id || oldest.id === before) break;
      before = oldest.id;
      if (ordered.length < SEARCH_PAGE_SIZE) break;
      if (page === maxPages - 1) truncated = true;
    }
  }

  return { keyword, matches, scanned_messages: scanned, page_cap: maxPages, truncated };
}

async function getMessage(client, config, args) {
  const { message } = await fetchMessage(client, config, args);
  return { message: serializeMessage(message) };
}

async function sendMessage(client, config, args) {
  assertWrite(config);
  const channel = await requireTextChannel(client, config, args.channel_id);
  if (typeof channel.send !== 'function') throw new ToolError('Questo canale non accetta messaggi');
  const content = requireContent(args.content);
  const replyTo = optionalSnowflake(args.reply_to_message_id, 'reply_to_message_id');
  try {
    const sent = await channel.send(outgoing(content, replyTo));
    return { message: serializeMessage(sent) };
  } catch (error) {
    discordFailure(error, 'Invio del messaggio');
  }
}

async function replyInThread(client, config, args) {
  assertWrite(config);
  const thread = await requireTextChannel(client, config, args.thread_id, 'thread_id');
  if (!thread.isThread?.()) throw new ToolError('thread_id non è un thread');
  if (typeof thread.send !== 'function') throw new ToolError('Questo thread non accetta messaggi');
  const content = requireContent(args.content);
  const replyTo = optionalSnowflake(args.reply_to_message_id, 'reply_to_message_id');
  try {
    const sent = await thread.send(outgoing(content, replyTo));
    return { message: serializeMessage(sent) };
  } catch (error) {
    discordFailure(error, 'Invio nel thread');
  }
}

async function createThread(client, config, args) {
  assertWrite(config);
  const channel = await requireChannel(client, config, args.channel_id);
  const name = requireThreadName(args.name);
  const autoArchiveDuration = optionalArchive(args.auto_archive_duration);
  const content = args.content == null || args.content === '' ? null : requireContent(args.content);
  const base = { name };
  if (autoArchiveDuration != null) base.autoArchiveDuration = autoArchiveDuration;

  try {
    if (args.message_id != null && args.message_id !== '') {
      assertTextChannel(channel);
      const messageId = requireSnowflake(args.message_id, 'message_id');
      const message = await channel.messages.fetch(messageId);
      if (typeof message.startThread !== 'function') {
        throw new ToolError('Questo messaggio non può aprire un thread');
      }
      const thread = await message.startThread(base);
      const sent = content ? await thread.send(outgoing(content)) : null;
      return {
        thread: serializeThread(thread),
        message: sent ? serializeMessage(sent) : null,
      };
    }

    if (isForumChannel(channel)) {
      if (!content) {
        throw new ToolError('Nei forum content è obbligatorio: è il primo messaggio del thread');
      }
      const thread = await channel.threads.create({
        ...base,
        message: { content, allowedMentions: MENTIONS },
      });
      return { thread: serializeThread(thread), message: null };
    }

    if (typeof channel.threads?.create !== 'function') {
      throw new ToolError('Questo canale non supporta la creazione di thread');
    }
    const type =
      channel.type === ChannelType.GuildAnnouncement
        ? ChannelType.AnnouncementThread
        : ChannelType.PublicThread;
    const thread = await channel.threads.create({ ...base, type });
    const sent = content ? await thread.send(outgoing(content)) : null;
    return {
      thread: serializeThread(thread),
      message: sent ? serializeMessage(sent) : null,
    };
  } catch (error) {
    discordFailure(error, 'Creazione del thread');
  }
}

async function addReaction(client, config, args) {
  assertWrite(config);
  const { message } = await fetchMessage(client, config, args);
  const emoji = requireEmoji(args.emoji);
  if (typeof message.react !== 'function') throw new ToolError('Questo messaggio non accetta reazioni');
  try {
    await message.react(emoji);
  } catch (error) {
    discordFailure(error, 'Aggiunta della reazione');
  }
  return { channel_id: message.channelId ?? args.channel_id, message_id: message.id, emoji };
}

async function removeReaction(client, config, args) {
  assertWrite(config);
  const { message } = await fetchMessage(client, config, args);
  const emoji = requireEmoji(args.emoji);
  let reaction = message.reactions?.resolve?.(emoji) ?? null;
  if (!reaction && typeof message.reactions?.fetch === 'function') {
    try {
      const all = await message.reactions.fetch();
      reaction = all?.resolve?.(emoji) ?? all?.get?.(emoji) ?? null;
    } catch (error) {
      discordFailure(error, 'Lettura delle reazioni');
    }
  }
  if (!reaction || typeof reaction.users?.remove !== 'function') {
    throw new ToolError('Reazione del bot non trovata su questo messaggio');
  }
  try {
    await reaction.users.remove(client.user.id);
  } catch (error) {
    discordFailure(error, 'Rimozione della reazione');
  }
  return {
    channel_id: message.channelId ?? args.channel_id,
    message_id: message.id,
    emoji,
    removed: true,
  };
}

async function editMessage(client, config, args) {
  assertWrite(config);
  const { message } = await fetchMessage(client, config, args);
  if (!isOwnMessage(client, message)) {
    throw new ToolError('Si può modificare solo un messaggio inviato dal bot');
  }
  const content = requireContent(args.content);
  try {
    const edited = await message.edit({ content, allowedMentions: MENTIONS });
    return { message: serializeMessage(edited) };
  } catch (error) {
    discordFailure(error, 'Modifica del messaggio');
  }
}

async function deleteMessage(client, config, args) {
  assertWrite(config);
  const { message } = await fetchMessage(client, config, args);
  if (!isOwnMessage(client, message)) {
    throw new ToolError('Si può eliminare solo un messaggio inviato dal bot');
  }
  try {
    await message.delete();
  } catch (error) {
    discordFailure(error, 'Eliminazione del messaggio');
  }
  return { deleted: true, id: message.id, channel_id: message.channelId ?? args.channel_id };
}

async function pinMessage(client, config, args, pin) {
  assertWrite(config);
  const { message } = await fetchMessage(client, config, args);
  try {
    if (pin) await message.pin();
    else await message.unpin();
  } catch (error) {
    discordFailure(error, pin ? 'Pin del messaggio' : 'Rimozione del pin');
  }
  return {
    pinned: pin,
    id: message.id,
    channel_id: message.channelId ?? args.channel_id,
    url: serializeMessage(message).url,
  };
}

async function listMembers(client, config, args) {
  const guild = await resolveGuild(client, config, args.guild_id);
  const limit = optionalInt(args.limit, { min: 1, max: 100, fallback: 25, field: 'limit' });
  let query = null;
  if (args.query != null && args.query !== '') {
    if (typeof args.query !== 'string' || args.query.length > 32) {
      throw new ToolError('query deve essere un prefisso del nome, da 1 a 32 caratteri');
    }
    query = args.query;
  }
  const options = query ? { query, limit } : { limit };
  try {
    const members = await guild.members.fetch(options);
    return {
      guild_id: guild.id,
      members: listOf(members).map(serializeMember),
    };
  } catch (error) {
    discordFailure(error, 'Lettura dei membri');
  }
}

async function getMember(client, config, args) {
  const guild = await resolveGuild(client, config, args.guild_id);
  const userId = requireSnowflake(args.user_id, 'user_id');
  try {
    const member = await guild.members.fetch(userId);
    return { member: serializeMember(member) };
  } catch (error) {
    discordFailure(error, 'Lettura del membro');
  }
}

async function assertUserInScope(client, config, userId) {
  if (!config.guildIds) return;
  for (const guildId of config.guildIds) {
    if (!guildAllowed(config, guildId)) continue;
    const guild = client.guilds.cache.get(String(guildId));
    if (!guild || typeof guild.members?.fetch !== 'function') continue;
    try {
      await guild.members.fetch(userId);
      return;
    } catch {
      // Not a member of this allowed guild.
    }
  }
  throw new ToolError('Utente non trovato nei server consentiti da GUILD_IDS');
}

async function sendDm(client, config, args) {
  assertWrite(config);
  assertReady(client);
  const userId = requireSnowflake(args.user_id, 'user_id');
  const content = requireContent(args.content);
  await assertUserInScope(client, config, userId);
  try {
    const user = await client.users.fetch(userId);
    if (typeof user.send !== 'function') {
      throw new ToolError('Impossibile aprire un messaggio diretto con questo utente');
    }
    const sent = await user.send(outgoing(content));
    return { message: serializeMessage(sent) };
  } catch (error) {
    discordFailure(error, 'Invio del messaggio diretto');
  }
}

export function createDiscordTools(client, config) {
  const allowWrite = config.allowWrite !== false;
  const tools = [
    {
      name: 'list_guilds',
      title: 'Elenco server',
      description:
        'Elenca i server Discord visibili al bot. Se GUILD_IDS è impostato, restituisce solo quei server.',
      inputSchema: {},
      annotations: readAnnotations,
      readOnly: true,
      handler: () => listGuilds(client, config),
    },
    {
      name: 'list_channels',
      title: 'Elenco canali',
      description:
        'Elenca i canali di un server, inclusi i thread attivi. Con include_archived=true aggiunge anche fino a 50 thread pubblici archiviati per canale (massimo 25 canali padre). Se guild_id manca e il bot vede un solo server consentito, usa quello. Rispetta GUILD_IDS.',
      inputSchema: {
        guild_id: snowflake.optional().describe('ID del server. Obbligatorio se il bot è in più server.'),
        include_archived: z
          .boolean()
          .optional()
          .describe('Se true, include una pagina di thread pubblici archiviati. Predefinito false.'),
      },
      annotations: readAnnotations,
      readOnly: true,
      handler: (args) => listChannels(client, config, args),
    },
    {
      name: 'read_messages',
      title: 'Leggi messaggi',
      description:
        'Legge i messaggi di un canale. limit va da 1 a 100 (predefinito 50). Si può indicare uno solo tra before, after e around, ciascuno un ID messaggio. Ogni messaggio include autore (id, username, display_name), content, created_at, edited_at, allegati, reply_to e url.',
      inputSchema: {
        channel_id: snowflake.describe('ID del canale o del thread.'),
        limit: z.number().int().min(1).max(100).optional().describe('Quanti messaggi leggere, massimo 100.'),
        before: snowflake.optional().describe('ID messaggio: restituisce i messaggi più vecchi di questo.'),
        after: snowflake.optional().describe('ID messaggio: restituisce i messaggi più recenti di questo.'),
        around: snowflake.optional().describe('ID messaggio: restituisce i messaggi attorno a questo.'),
      },
      annotations: readAnnotations,
      readOnly: true,
      handler: (args) => readMessages(client, config, args),
    },
    {
      name: 'search_messages',
      title: 'Cerca messaggi',
      description:
        'Cerca una keyword nel testo e nei nomi degli allegati della cronologia recente di uno o più canali. Non è la ricerca globale di Discord: scorre al massimo max_pages pagine da 100 messaggi per canale (predefinito 3, massimo 10) e al massimo 10 canali. Rispetta GUILD_IDS.',
      inputSchema: {
        keyword: z.string().min(1).max(200).describe('Testo da cercare, senza distinzione tra maiuscole e minuscole.'),
        channel_id: snowflake.optional().describe('Un canale in cui cercare.'),
        channel_ids: z
          .array(snowflake)
          .min(1)
          .max(10)
          .optional()
          .describe('Più canali in cui cercare, massimo 10.'),
        max_pages: z
          .number()
          .int()
          .min(1)
          .max(10)
          .optional()
          .describe('Pagine da 100 messaggi per canale. Predefinito 3, massimo 10.'),
        limit: z.number().int().min(1).max(100).optional().describe('Massimo di risultati da restituire. Predefinito 25.'),
      },
      annotations: readAnnotations,
      readOnly: true,
      handler: (args) => searchMessages(client, config, args),
    },
    {
      name: 'get_message',
      title: 'Leggi un messaggio',
      description:
        'Legge un messaggio per ID. Restituisce autore (id, username, display_name), content, created_at, edited_at, allegati, reply_to e url.',
      inputSchema: {
        channel_id: snowflake,
        message_id: snowflake,
      },
      annotations: readAnnotations,
      readOnly: true,
      handler: (args) => getMessage(client, config, args),
    },
    {
      name: 'list_members',
      title: 'Elenco membri',
      description:
        'Elenca o cerca membri di un server. query è il prefisso del nome utente (massimo 32 caratteri). limit va da 1 a 100 (predefinito 25). Rispetta GUILD_IDS. Richiede il Server Members Intent.',
      inputSchema: {
        guild_id: snowflake.optional().describe('ID del server. Obbligatorio se il bot è in più server.'),
        query: z.string().min(1).max(32).optional().describe('Prefisso del nome utente da cercare.'),
        limit: z.number().int().min(1).max(100).optional(),
      },
      annotations: readAnnotations,
      readOnly: true,
      handler: (args) => listMembers(client, config, args),
    },
    {
      name: 'get_member',
      title: 'Leggi un membro',
      description: 'Legge un membro di un server per ID utente. Rispetta GUILD_IDS.',
      inputSchema: {
        guild_id: snowflake,
        user_id: snowflake,
      },
      annotations: readAnnotations,
      readOnly: true,
      handler: (args) => getMember(client, config, args),
    },
    {
      name: 'send_message',
      title: 'Invia un messaggio',
      description: `Invia un messaggio in un canale o in un thread. ${BOT_ACTOR_PHRASE} reply_to_message_id è facoltativo. Le menzioni @everyone e @here vengono soppresse.`,
      inputSchema: {
        channel_id: snowflake,
        content: z.string().min(1).max(2000).describe('Testo del messaggio, massimo 2000 caratteri.'),
        reply_to_message_id: snowflake.optional().describe('ID del messaggio a cui rispondere.'),
      },
      annotations: writeAnnotations,
      readOnly: false,
      handler: (args) => sendMessage(client, config, args),
    },
    {
      name: 'reply_in_thread',
      title: 'Scrivi in un thread',
      description: `Scrive in un thread già esistente. ${BOT_ACTOR_PHRASE} Per aprire un thread nuovo usa create_thread.`,
      inputSchema: {
        thread_id: snowflake.describe('ID del thread.'),
        content: z.string().min(1).max(2000),
        reply_to_message_id: snowflake.optional(),
      },
      annotations: writeAnnotations,
      readOnly: false,
      handler: (args) => replyInThread(client, config, args),
    },
    {
      name: 'create_thread',
      title: 'Crea un thread',
      description: `Crea un thread pubblico. Se message_id è presente, il thread parte da quel messaggio; altrimenti viene creato nel canale. Nei forum content è il primo messaggio. ${BOT_ACTOR_PHRASE}`,
      inputSchema: {
        channel_id: snowflake.describe('Canale padre, oppure forum.'),
        name: z.string().min(1).max(100).describe('Nome del thread, massimo 100 caratteri.'),
        message_id: snowflake.optional().describe('Se presente, apre il thread a partire da questo messaggio.'),
        content: z
          .string()
          .min(1)
          .max(2000)
          .optional()
          .describe('Primo messaggio nel thread. Obbligatorio nei forum.'),
        auto_archive_duration: z
          .union([z.literal(60), z.literal(1440), z.literal(4320), z.literal(10080)])
          .optional()
          .describe('Minuti prima dell’archiviazione automatica: 60, 1440, 4320 o 10080.'),
      },
      annotations: writeAnnotations,
      readOnly: false,
      handler: (args) => createThread(client, config, args),
    },
    {
      name: 'add_reaction',
      title: 'Aggiungi una reazione',
      description: `Aggiunge una reazione a un messaggio. ${BOT_ACTOR_PHRASE} emoji è un carattere Unicode oppure il formato name:id o <:name:id> per un’emoji personalizzata.`,
      inputSchema: {
        channel_id: snowflake,
        message_id: snowflake,
        emoji: z.string().min(1).max(100),
      },
      annotations: { ...writeAnnotations, idempotentHint: true },
      readOnly: false,
      handler: (args) => addReaction(client, config, args),
    },
    {
      name: 'remove_reaction',
      title: 'Rimuovi una reazione',
      description: `Rimuove la reazione del bot da un messaggio. ${BOT_ACTOR_PHRASE} Non toglie le reazioni degli altri utenti.`,
      inputSchema: {
        channel_id: snowflake,
        message_id: snowflake,
        emoji: z.string().min(1).max(100),
      },
      annotations: { ...writeAnnotations, idempotentHint: true },
      readOnly: false,
      handler: (args) => removeReaction(client, config, args),
    },
    {
      name: 'edit_message',
      title: 'Modifica un messaggio',
      description: `Modifica il testo di un messaggio. Si può modificare solo un messaggio inviato dal bot. ${BOT_ACTOR_PHRASE}`,
      inputSchema: {
        channel_id: snowflake,
        message_id: snowflake,
        content: z.string().min(1).max(2000),
      },
      annotations: writeAnnotations,
      readOnly: false,
      handler: (args) => editMessage(client, config, args),
    },
    {
      name: 'delete_message',
      title: 'Elimina un messaggio',
      description: `Elimina un messaggio. Si può eliminare solo un messaggio inviato dal bot. ${BOT_ACTOR_PHRASE}`,
      inputSchema: {
        channel_id: snowflake,
        message_id: snowflake,
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
      readOnly: false,
      handler: (args) => deleteMessage(client, config, args),
    },
    {
      name: 'pin_message',
      title: 'Fissa un messaggio',
      description: `Fissa un messaggio in alto nel canale. ${BOT_ACTOR_PHRASE} Serve il permesso Manage Messages.`,
      inputSchema: {
        channel_id: snowflake,
        message_id: snowflake,
      },
      annotations: { ...writeAnnotations, idempotentHint: true },
      readOnly: false,
      handler: (args) => pinMessage(client, config, args, true),
    },
    {
      name: 'unpin_message',
      title: 'Togli il pin',
      description: `Toglie il pin da un messaggio. ${BOT_ACTOR_PHRASE} Serve il permesso Manage Messages.`,
      inputSchema: {
        channel_id: snowflake,
        message_id: snowflake,
      },
      annotations: { ...writeAnnotations, idempotentHint: true },
      readOnly: false,
      handler: (args) => pinMessage(client, config, args, false),
    },
    {
      name: 'send_dm',
      title: 'Invia un messaggio diretto',
      description: `Invia un messaggio diretto a un utente tramite il bot. ${BOT_ACTOR_PHRASE} Se GUILD_IDS è impostato, l’utente deve essere membro di uno di quei server. Le menzioni @everyone e @here vengono soppresse.`,
      inputSchema: {
        user_id: snowflake,
        content: z.string().min(1).max(2000),
      },
      annotations: writeAnnotations,
      readOnly: false,
      handler: (args) => sendDm(client, config, args),
    },
  ];

  return allowWrite ? tools : tools.filter((tool) => tool.readOnly);
}

export function registerDiscordTools(server, client, config) {
  for (const tool of createDiscordTools(client, config)) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
        annotations: tool.annotations,
      },
      (args) => invokeTool(tool, args),
    );
  }
}
