const MENTION =
  /<(?:(?<type>@[!&]?|#)|(?:\/(?<commandName>[^:>]+):)|(?:a?:(?<emojiName>\w+):))(?<id>\d+)>/g;

/**
 * Turns Discord mention syntax into readable text.
 * `maps` values are id → display label, without the leading @ or #.
 */
export function cleanDiscordSyntax(content, maps = {}) {
  const users = maps.users ?? new Map();
  const roles = maps.roles ?? new Map();
  const channels = maps.channels ?? new Map();

  return String(content ?? '').replace(MENTION, (...args) => {
    const groups = args.at(-1) ?? {};
    const { type, commandName, emojiName, id } = groups;
    if (commandName) return `/${commandName}`;
    if (emojiName) return `:${emojiName}:`;
    const key = String(id);
    if (type === '@' || type === '@!') {
      const name = users.get(key);
      return name ? `@${name}` : `@${key}`;
    }
    if (type === '@&') {
      const name = roles.get(key);
      return name ? `@${name}` : `@${key}`;
    }
    if (type === '#') {
      const name = channels.get(key);
      return name ? `#${name}` : `#${key}`;
    }
    return args[0];
  });
}

export function buildCleanContent({ content = '', attachments = [], embedTitles = [] } = {}) {
  const blocks = [];
  const text = String(content ?? '').trim();
  if (text) blocks.push(text);

  const urls = attachments.map((url) => String(url).trim()).filter(Boolean);
  if (urls.length > 0) blocks.push(urls.join('\n'));

  const titles = embedTitles.map((title) => String(title).trim()).filter(Boolean);
  if (titles.length > 0) blocks.push(titles.map((title) => `Embed: ${title}`).join('\n'));

  return blocks.join('\n\n');
}
