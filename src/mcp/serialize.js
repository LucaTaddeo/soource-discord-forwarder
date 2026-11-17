export function toIso(value) {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'number' && Number.isFinite(value)) return new Date(value).toISOString();
  if (typeof value === 'string' && value) return value;
  return null;
}

export function listOf(value) {
  if (!value) return [];
  if (typeof value.values === 'function') return [...value.values()];
  if (Array.isArray(value)) return value;
  return [];
}

export function messageUrl(message) {
  if (typeof message.url === 'string' && message.url.length > 0) return message.url;
  const guild = message.guildId ?? '@me';
  const channel = message.channelId ?? '@me';
  return `https://discord.com/channels/${guild}/${channel}/${message.id}`;
}

export function serializeAuthor(message) {
  const author = message.author ?? {};
  const member = message.member ?? null;
  return {
    id: author.id ?? null,
    username: author.username ?? null,
    display_name: member?.displayName ?? author.globalName ?? author.username ?? null,
  };
}

export function serializeAttachment(attachment) {
  return {
    id: attachment.id ?? null,
    name: attachment.name ?? null,
    url: attachment.url ?? null,
    content_type: attachment.contentType ?? attachment.content_type ?? null,
    size: attachment.size ?? null,
  };
}

export function serializeReference(reference) {
  if (!reference) return null;
  const messageId = reference.messageId ?? reference.message_id ?? null;
  if (!messageId) return null;
  return {
    message_id: messageId,
    channel_id: reference.channelId ?? reference.channel_id ?? null,
    guild_id: reference.guildId ?? reference.guild_id ?? null,
  };
}

export function serializeMessage(message) {
  return {
    id: message.id,
    channel_id: message.channelId ?? null,
    guild_id: message.guildId ?? null,
    author: serializeAuthor(message),
    content: message.content ?? '',
    created_at: toIso(message.createdAt ?? message.createdTimestamp),
    edited_at: toIso(message.editedAt ?? message.editedTimestamp),
    attachments: listOf(message.attachments).map(serializeAttachment),
    reply_to: serializeReference(message.reference),
    url: messageUrl(message),
    pinned: Boolean(message.pinned),
  };
}

export function serializeChannel(channel) {
  return {
    id: channel.id,
    name: channel.name ?? null,
    type: channel.type ?? null,
    guild_id: channel.guildId ?? channel.guild?.id ?? null,
    parent_id: channel.parentId ?? null,
    thread: Boolean(channel.isThread?.()),
    archived: channel.archived ?? null,
  };
}

export function serializeThread(thread) {
  const guildId = thread.guildId ?? thread.guild?.id ?? null;
  return {
    id: thread.id,
    name: thread.name ?? null,
    guild_id: guildId,
    parent_id: thread.parentId ?? null,
    archived: Boolean(thread.archived),
    url: thread.url ?? (guildId ? `https://discord.com/channels/${guildId}/${thread.id}` : null),
  };
}

export function serializeMember(member) {
  const user = member.user ?? {};
  const roles = [];
  for (const role of listOf(member.roles?.cache)) {
    if (role.name === '@everyone') continue;
    roles.push({ id: role.id, name: role.name });
  }
  return {
    id: member.id ?? user.id ?? null,
    username: user.username ?? null,
    display_name: member.displayName ?? user.globalName ?? user.username ?? null,
    nickname: member.nickname ?? null,
    bot: Boolean(user.bot),
    joined_at: toIso(member.joinedAt),
    roles,
  };
}
