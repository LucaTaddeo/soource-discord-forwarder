import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * Compares two strings without returning early on the first mismatched byte.
 * SHA-256 digests are a fixed length, so `timingSafeEqual` still works when
 * the provided token and the key have different lengths.
 */
export function timingSafeStringEqual(left, right) {
  const a = createHash('sha256').update(String(left), 'utf8').digest();
  const b = createHash('sha256').update(String(right), 'utf8').digest();
  return timingSafeEqual(a, b);
}

export function extractBearerToken(header) {
  if (typeof header !== 'string') return null;
  const match = /^Bearer[ \t]+(\S+)$/i.exec(header.trim());
  return match ? match[1] : null;
}

export function isAuthorized(authorizationHeader, apiKey) {
  if (typeof apiKey !== 'string' || apiKey.length === 0) return false;
  const token = extractBearerToken(authorizationHeader);
  if (token == null) return false;
  return timingSafeStringEqual(token, apiKey);
}
