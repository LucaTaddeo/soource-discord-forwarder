function hasId(set, id) {
  if (!set || id == null || id === '') return false;
  return set.has(String(id));
}

/**
 * Scope filters that do not need mention or reply resolution.
 * Direct messages bypass both guild and channel allow-lists: a DM has no
 * server, and the channel list is for guild channels only.
 */
function scopeRejection(message, config) {
  if (message.incomplete || !message.authorId || !message.channelId) return 'incomplete';
  if (message.authorIsBot) return 'bot';
  if (message.system) return 'system';
  if (config.ownerUserId && String(message.authorId) === String(config.ownerUserId)) return 'owner';
  if (!message.isDm && config.guildIds && !hasId(config.guildIds, message.guildId)) return 'guild';
  if (!message.isDm && config.channelIds && !hasId(config.channelIds, message.channelId)) return 'channel';
  return null;
}

export function inScope(message, config) {
  const reason = scopeRejection(message, config);
  return { ok: reason == null, reason: reason ?? 'ok' };
}

/**
 * @returns {{ forward: boolean, reason: string }}
 */
export function shouldForward(message, config) {
  const reason = scopeRejection(message, config);
  if (reason) return { forward: false, reason };

  if (config.forwardMode === 'mentions') {
    const relevant = Boolean(message.isDm || message.mentionsOwner || message.isReplyToOwner);
    if (!relevant) return { forward: false, reason: 'mode' };
  }

  return { forward: true, reason: 'ok' };
}

export function uniqueIds(values) {
  const seen = new Set();
  const ids = [];
  for (const value of values) {
    if (value == null || value === '') continue;
    const id = String(value);
    if (seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

/** User IDs explicitly mentioned. The replied-to user is not a direct mention by itself. */
export function directUserMentionIds(content, apiUserIds = [], repliedUserId = null) {
  const fromContent = [...String(content ?? '').matchAll(/<@!?(\d+)>/g)].map((match) => match[1]);
  const reply = repliedUserId == null || repliedUserId === '' ? null : String(repliedUserId);
  const fromApi = [...apiUserIds].map(String).filter((id) => id !== reply);
  return uniqueIds([...fromContent, ...fromApi]);
}

export function roleMentionIds(content, apiRoleIds = []) {
  const fromContent = [...String(content ?? '').matchAll(/<@&(\d+)>/g)].map((match) => match[1]);
  return uniqueIds([...fromContent, ...apiRoleIds]);
}

/**
 * True when the owner is @mentioned directly, a role they hold is @mentioned,
 * or @everyone / @here is used (caller decides whether the owner is in the server).
 */
export function computeMentionsOwner({
  ownerUserId = null,
  mentionedUserIds = [],
  mentionedRoleIds = [],
  ownerRoleIds = [],
  mentionsEveryone = false,
} = {}) {
  if (!ownerUserId) return false;
  const owner = String(ownerUserId);
  if (mentionedUserIds.some((id) => String(id) === owner)) return true;
  if (mentionsEveryone) return true;
  const roles = new Set(ownerRoleIds.map(String));
  return mentionedRoleIds.some((id) => roles.has(String(id)));
}
