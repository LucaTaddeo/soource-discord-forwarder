import { cleanDiscordSyntax } from './content.js';
import { computeMentionsOwner, directUserMentionIds, roleMentionIds } from './filter.js';

export function isDirectMessage(message) {
  if (typeof message.channel?.isDMBased === 'function') {
    return message.channel.isDMBased() === true;
  }
  return message.guildId == null;
}

function valuesOf(collection) {
  if (!collection) return [];
  if (typeof collection.values === 'function') return [...collection.values()];
  if (Array.isArray(collection)) return collection;
  return [];
}

function idsOf(collection) {
  return valuesOf(collection)
    .map((item) => (typeof item === 'string' || typeof item === 'number' ? item : item?.id))
    .filter((id) => id != null && id !== '');
}

function labelMap(collection, labelFor) {
  const map = new Map();
  for (const item of valuesOf(collection)) {
    if (!item || item.id == null) continue;
    const label = labelFor(item);
    if (label) map.set(String(item.id), String(label));
  }
  return map;
}

export function messageScope(message) {
  const authorId = message.author?.id == null || message.author.id === '' ? '' : String(message.author.id);
  const channelId = message.channelId == null || message.channelId === '' ? '' : String(message.channelId);
  return {
    authorIsBot: Boolean(message.author?.bot || message.author?.system || message.webhookId),
    system: Boolean(message.system),
    authorId,
    guildId: message.guildId == null || message.guildId === '' ? null : String(message.guildId),
    channelId,
    isDm: isDirectMessage(message),
    incomplete: !authorId || !channelId,
  };
}

function authorDisplayName(message) {
  return message.member?.displayName || message.author?.globalName || message.author?.username || 'sconosciuto';
}

function jumpUrl(message, isDm) {
  if (typeof message.url === 'string' && message.url.length > 0) return message.url;
  const guild = isDm || message.guildId == null ? '@me' : message.guildId;
  return `https://discord.com/channels/${guild}/${message.channelId}/${message.id}`;
}

function createdAtIso(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
  if (typeof value === 'number' && Number.isFinite(value)) return new Date(value).toISOString();
  if (typeof value === 'string' && value.trim()) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  return null;
}

/** Discord MessageReferenceType.Forward is 1. A missing type is a normal reply. */
function isReplyReference(reference) {
  if (!reference?.messageId) return false;
  return reference.type !== 1;
}

function mentionLabels(message) {
  const members = message.mentions?.members;
  return {
    users: labelMap(message.mentions?.users, (user) => {
      const member = members?.get?.(user.id) ?? members?.get?.(String(user.id));
      return member?.displayName || user.globalName || user.username || String(user.id);
    }),
    roles: labelMap(message.mentions?.roles, (role) => role.name),
    channels: labelMap(message.mentions?.channels, (channel) => channel.name),
  };
}

export async function inspectMessage(message, ownerUserId, options = {}) {
  const scope = messageScope(message);
  const repliedUserId = message.mentions?.repliedUser?.id ?? null;
  const replyReference = isReplyReference(message.reference);

  let isReplyToOwner = false;
  if (ownerUserId && replyReference) {
    if (repliedUserId != null && String(repliedUserId) === String(ownerUserId)) {
      isReplyToOwner = true;
    } else if (repliedUserId == null && typeof options.fetchReference === 'function') {
      try {
        const referenced = await options.fetchReference(message);
        const authorId = referenced?.author?.id;
        isReplyToOwner = authorId != null && String(authorId) === String(ownerUserId);
      } catch {
        isReplyToOwner = false;
      }
    }
  }

  const mentionedUserIds = directUserMentionIds(message.content, idsOf(message.mentions?.users), repliedUserId);
  const mentionedRoleIds = roleMentionIds(message.content, idsOf(message.mentions?.roles));
  const mentionsEveryone = Boolean(message.mentions?.everyone);
  const needsMember = Boolean(ownerUserId && !scope.isDm && (mentionedRoleIds.length > 0 || mentionsEveryone));

  let ownerRoleIds = [];
  let ownerInGuild = false;
  if (needsMember && typeof options.fetchOwnerMember === 'function') {
    try {
      const member = await options.fetchOwnerMember(scope.guildId, ownerUserId);
      if (member && !member.missing) {
        ownerInGuild = true;
        ownerRoleIds = (member.roleIds ?? []).map(String);
      }
    } catch {
      ownerInGuild = false;
    }
  }

  const mentionsOwner = computeMentionsOwner({
    ownerUserId,
    mentionedUserIds,
    mentionedRoleIds,
    ownerRoleIds,
    mentionsEveryone: mentionsEveryone && ownerInGuild,
  });

  const attachments = valuesOf(message.attachments)
    .map((attachment) => attachment?.url)
    .filter((url) => typeof url === 'string' && url.length > 0);
  const embedTitles = (message.embeds ?? [])
    .map((embed) => embed?.title)
    .filter((title) => typeof title === 'string' && title.trim().length > 0);

  return {
    filter: {
      ...scope,
      mentionsOwner,
      isReplyToOwner,
    },
    payload: {
      server: scope.isDm ? null : (message.guild?.name ?? null),
      serverId: scope.isDm ? null : scope.guildId,
      channel: scope.isDm ? 'DM' : message.channel?.name || scope.channelId,
      channelId: scope.channelId,
      author: authorDisplayName(message),
      authorId: scope.authorId,
      content: cleanDiscordSyntax(message.content ?? '', mentionLabels(message)),
      attachments,
      embedTitles,
      url: jumpUrl(message, scope.isDm),
      mentionsOwner,
      isReplyToOwner,
      isDm: scope.isDm,
      createdAt: createdAtIso(message.createdAt ?? message.createdTimestamp),
    },
  };
}
