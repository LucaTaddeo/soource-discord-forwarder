const FORWARD_MODES = new Set(['all', 'mentions']);

function normalizeId(raw) {
  const trimmed = String(raw ?? '').trim();
  if (!trimmed) return '';
  const mention = trimmed.match(/^<@!?&?(\d+)>$/) || trimmed.match(/^<#(\d+)>$/);
  return mention ? mention[1] : trimmed;
}

/**
 * Parses a comma-separated list of Discord IDs.
 * Empty input means "no filter" and returns null.
 * Mention wrappers such as `<#123>` or `<@123>` are accepted.
 * @returns {Set<string> | null}
 */
export function parseIdList(value) {
  if (value == null) return null;
  const ids = String(value)
    .split(',')
    .map((part) => normalizeId(part))
    .filter(Boolean);
  if (ids.length === 0) return null;
  return new Set(ids);
}

function emptyToNull(value) {
  const normalized = normalizeId(value);
  return normalized ? normalized : null;
}

function assertHttpUrl(webhookUrl) {
  let parsed;
  try {
    parsed = new URL(webhookUrl);
  } catch {
    throw new Error('WEBHOOK_URL non è un URL valido');
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('WEBHOOK_URL deve usare http o https');
  }
  return parsed;
}

/** Host only: the path of a webhook URL is often a secret. */
export function describeWebhookUrl(webhookUrl) {
  return new URL(webhookUrl).origin;
}

function parseForwardMode(value) {
  const mode = (value == null || String(value).trim() === '' ? 'all' : String(value).trim()).toLowerCase();
  if (!FORWARD_MODES.has(mode)) {
    throw new Error("FORWARD_MODE deve essere 'all' oppure 'mentions'");
  }
  return mode;
}

function parseMcpApiKey(value) {
  const trimmed = value == null ? '' : String(value).trim();
  return trimmed ? trimmed : null;
}

function parseAllowWrite(value) {
  if (value == null || String(value).trim() === '') return true;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  throw new Error("ALLOW_WRITE deve essere 'true' oppure 'false'");
}

const DEFAULT_FORWARD_DEBOUNCE_MS = 120_000;
const DEFAULT_FORWARD_MAX_BATCH = 20;
const DEFAULT_FORWARD_MAX_WAIT_MS = 600_000;

function parseNonNegativeInteger(value, name, fallback) {
  if (value == null || String(value).trim() === '') return fallback;
  const raw = String(value).trim();
  if (!/^\d+$/.test(raw)) {
    throw new Error(`${name} deve essere un intero maggiore o uguale a 0`);
  }
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`${name} deve essere un intero maggiore o uguale a 0`);
  }
  return parsed;
}

function parseBatchSize(value) {
  const parsed = parseNonNegativeInteger(value, 'FORWARD_MAX_BATCH', DEFAULT_FORWARD_MAX_BATCH);
  if (parsed < 1) {
    throw new Error('FORWARD_MAX_BATCH deve essere un intero maggiore o uguale a 1');
  }
  return parsed;
}

function parsePort(value) {
  if (value == null || String(value).trim() === '') return 3000;
  const raw = String(value).trim();
  if (!/^\d+$/.test(raw)) {
    throw new Error('PORT deve essere un numero intero tra 1 e 65535');
  }
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT deve essere un numero intero tra 1 e 65535');
  }
  return port;
}

export function loadWebhookConfig(env = process.env) {
  const webhookUrl = env.WEBHOOK_URL?.trim() ?? '';
  const authorization = env.WEBHOOK_AUTHORIZATION?.trim() ?? '';
  const missing = [];
  if (!webhookUrl) missing.push('WEBHOOK_URL');
  if (!authorization) missing.push('WEBHOOK_AUTHORIZATION');
  if (missing.length > 0) {
    throw new Error(`Variabili d'ambiente mancanti: ${missing.join(', ')}`);
  }
  assertHttpUrl(webhookUrl);
  return { webhookUrl, authorization };
}

export function loadConfig(env = process.env) {
  const token = env.DISCORD_TOKEN?.trim() ?? '';
  const webhookUrl = env.WEBHOOK_URL?.trim() ?? '';
  const authorization = env.WEBHOOK_AUTHORIZATION?.trim() ?? '';
  const missing = [];
  if (!token) missing.push('DISCORD_TOKEN');
  if (!webhookUrl) missing.push('WEBHOOK_URL');
  if (!authorization) missing.push('WEBHOOK_AUTHORIZATION');
  if (missing.length > 0) {
    throw new Error(`Variabili d'ambiente mancanti: ${missing.join(', ')}`);
  }

  assertHttpUrl(webhookUrl);

  return {
    token,
    webhookUrl,
    authorization,
    ownerUserId: emptyToNull(env.OWNER_USER_ID),
    guildIds: parseIdList(env.GUILD_IDS),
    channelIds: parseIdList(env.CHANNEL_IDS),
    forwardMode: parseForwardMode(env.FORWARD_MODE),
    forwardDebounceMs: parseNonNegativeInteger(
      env.FORWARD_DEBOUNCE_MS,
      'FORWARD_DEBOUNCE_MS',
      DEFAULT_FORWARD_DEBOUNCE_MS,
    ),
    forwardMaxBatch: parseBatchSize(env.FORWARD_MAX_BATCH),
    forwardMaxWaitMs: parseNonNegativeInteger(
      env.FORWARD_MAX_WAIT_MS,
      'FORWARD_MAX_WAIT_MS',
      DEFAULT_FORWARD_MAX_WAIT_MS,
    ),
    mcpApiKey: parseMcpApiKey(env.MCP_API_KEY),
    allowWrite: parseAllowWrite(env.ALLOW_WRITE),
    port: parsePort(env.PORT),
  };
}
