import { buildCleanContent } from './content.js';

export const PAYLOAD_FIELDS = [
  'server',
  'server_id',
  'channel',
  'channel_id',
  'author',
  'author_id',
  'content',
  'url',
  'mentions_owner',
  'is_reply_to_owner',
  'is_dm',
  'created_at',
];

export function buildPayload(input) {
  return {
    server: input.server ?? null,
    server_id: input.serverId ?? null,
    channel: input.channel ?? null,
    channel_id: input.channelId ?? null,
    author: input.author ?? null,
    author_id: input.authorId ?? null,
    content: buildCleanContent(input),
    url: input.url ?? null,
    mentions_owner: Boolean(input.mentionsOwner),
    is_reply_to_owner: Boolean(input.isReplyToOwner),
    is_dm: Boolean(input.isDm),
    created_at: input.createdAt ?? null,
  };
}

function attachmentUrls(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((url) => typeof url === 'string' && url.length > 0);
}

function messageText(entry) {
  return buildCleanContent({
    content: entry.content,
    attachments: [],
    embedTitles: entry.embedTitles,
  });
}

/**
 * One webhook body for a conversation batch.
 * Guild, channel and thread describe the conversation. The legacy single-message
 * fields (author, content, url, created_at, is_reply_to_owner) come from the
 * last message. `mentions_owner` is true when any message mentions the owner.
 */
export function buildBatchPayload(entries) {
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error('Il gruppo di messaggi è vuoto');
  }
  const first = entries[0];
  const last = entries[entries.length - 1];
  const legacy = buildPayload(last);
  return {
    server: legacy.server,
    server_id: legacy.server_id,
    channel: legacy.channel,
    channel_id: legacy.channel_id,
    thread: last.thread ?? null,
    thread_id: last.threadId ?? null,
    parent_channel: last.parentChannel ?? null,
    parent_channel_id: last.parentChannelId ?? null,
    author: legacy.author,
    author_id: legacy.author_id,
    content: legacy.content,
    url: legacy.url,
    mentions_owner: entries.some((entry) => Boolean(entry.mentionsOwner)),
    is_reply_to_owner: legacy.is_reply_to_owner,
    is_dm: legacy.is_dm,
    created_at: legacy.created_at,
    message_count: entries.length,
    first_timestamp: first.createdAt ?? null,
    last_timestamp: last.createdAt ?? null,
    messages: entries.map((entry) => ({
      id: entry.messageId ?? null,
      author: entry.author ?? null,
      author_id: entry.authorId ?? null,
      content: messageText(entry),
      timestamp: entry.createdAt ?? null,
      url: entry.url ?? null,
      attachments: attachmentUrls(entry.attachments),
      mentions_owner: Boolean(entry.mentionsOwner),
      is_reply_to_owner: Boolean(entry.isReplyToOwner),
    })),
  };
}

export function batchEntryFromPayload(payload) {
  const channelId = payload.channelId == null || payload.channelId === '' ? '' : String(payload.channelId);
  const threadId = payload.threadId == null || payload.threadId === '' ? null : String(payload.threadId);
  return {
    key: threadId || channelId,
    messageId: payload.messageId == null || payload.messageId === '' ? null : String(payload.messageId),
    server: payload.server ?? null,
    serverId: payload.serverId ?? null,
    channel: payload.channel ?? null,
    channelId: channelId || null,
    thread: payload.thread ?? null,
    threadId,
    parentChannel: payload.parentChannel ?? null,
    parentChannelId:
      payload.parentChannelId == null || payload.parentChannelId === '' ? null : String(payload.parentChannelId),
    author: payload.author ?? null,
    authorId: payload.authorId == null || payload.authorId === '' ? null : String(payload.authorId),
    content: payload.content ?? '',
    attachments: attachmentUrls(payload.attachments),
    embedTitles: Array.isArray(payload.embedTitles) ? payload.embedTitles : [],
    url: payload.url ?? null,
    mentionsOwner: Boolean(payload.mentionsOwner),
    isReplyToOwner: Boolean(payload.isReplyToOwner),
    isDm: Boolean(payload.isDm),
    createdAt: payload.createdAt ?? null,
  };
}

/** Fixed sample used by `npm run test-webhook`. */
export function samplePayload(now = new Date()) {
  const createdAt = now instanceof Date ? now.toISOString() : new Date(now).toISOString();
  return buildBatchPayload([
    {
      server: 'Soource',
      serverId: '000000000000000000',
      channel: 'generale',
      channelId: '000000000000000001',
      thread: null,
      threadId: null,
      parentChannel: null,
      parentChannelId: null,
      author: 'Utente di prova',
      authorId: '000000000000000002',
      messageId: '000000000000000003',
      content:
        'Messaggio di prova inviato da npm run test-webhook. Se lo vedi nel servizio ricevente, il webhook funziona.',
      attachments: [],
      embedTitles: [],
      url: 'https://discord.com/channels/000000000000000000/000000000000000001/000000000000000003',
      mentionsOwner: false,
      isReplyToOwner: false,
      isDm: false,
      createdAt,
    },
  ]);
}
