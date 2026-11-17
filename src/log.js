const secrets = new Set();

/**
 * Registers a value that must never appear in logs (bot token, Authorization
 * header, webhook URL). Matching is exact, so short fragments of the secret
 * are left untouched.
 */
export function addSecret(value) {
  if (typeof value !== 'string') return;
  const trimmed = value.trim();
  if (trimmed.length === 0) return;
  secrets.add(trimmed);
}

export function clearSecrets() {
  secrets.clear();
}

export function redact(text) {
  let output = String(text);
  for (const secret of secrets) {
    output = output.split(secret).join('[redacted]');
  }
  return output;
}

export function log(level, message) {
  const line = `[${new Date().toISOString()}] ${String(level).toUpperCase()} ${redact(message)}`;
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}
