import { inScope, shouldForward } from './filter.js';
import { inspectMessage, messageScope } from './inspectMessage.js';
import { buildPayload } from './payload.js';

/**
 * Decides whether a Discord message should be forwarded and, if so, builds
 * the webhook payload. Mention and reply lookups run only after the cheap
 * filters (bot, owner, guild, channel) have passed.
 */
export async function evaluateMessage(message, config, options = {}) {
  const scope = inScope(messageScope(message), config);
  if (!scope.ok) {
    return { forward: false, reason: scope.reason, payload: null };
  }

  const inspected = await inspectMessage(message, config.ownerUserId, options);
  const decision = shouldForward(inspected.filter, config);
  if (!decision.forward) {
    return { forward: false, reason: decision.reason, payload: null };
  }

  return {
    forward: true,
    reason: 'ok',
    payload: buildPayload(inspected.payload),
  };
}
