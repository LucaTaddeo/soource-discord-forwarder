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

/** Fixed sample used by `npm run test-webhook`. */
export function samplePayload(now = new Date()) {
  const createdAt = now instanceof Date ? now.toISOString() : new Date(now).toISOString();
  return {
    server: 'Soource',
    server_id: '000000000000000000',
    channel: 'generale',
    channel_id: '000000000000000001',
    author: 'Utente di prova',
    author_id: '000000000000000002',
    content:
      'Messaggio di prova inviato da npm run test-webhook. Se lo vedi nel servizio ricevente, il webhook funziona.',
    url: 'https://discord.com/channels/000000000000000000/000000000000000001/000000000000000003',
    mentions_owner: false,
    is_reply_to_owner: false,
    is_dm: false,
    created_at: createdAt,
  };
}
