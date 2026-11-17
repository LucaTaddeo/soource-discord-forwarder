/**
 * Groups messages of one conversation and flushes them as a single webhook
 * delivery after a quiet period, or sooner when a safety cap is reached.
 * The conversation key is the channel id: the thread id inside a thread,
 * and the DM channel id for a direct message.
 */

function channelIsThread(channel) {
  if (!channel) return false;
  if (typeof channel.isThread === 'function') return channel.isThread() === true;
  return channel.type === 10 || channel.type === 11 || channel.type === 12;
}

export function conversationKey(message) {
  const channel = message?.channel;
  if (channel && channelIsThread(channel) && channel.id != null && channel.id !== '') {
    return String(channel.id);
  }
  const channelId = message?.channelId ?? channel?.id;
  if (channelId == null || channelId === '') return '';
  return String(channelId);
}

export function isOwnMessage(message, botUserId) {
  if (botUserId == null || String(botUserId).trim() === '') return false;
  const authorId = message?.author?.id ?? message?.authorId;
  if (authorId == null || authorId === '') return false;
  return String(authorId) === String(botUserId);
}

function resolveBotUserId(botUserId) {
  const value = typeof botUserId === 'function' ? botUserId() : botUserId;
  if (value == null || String(value).trim() === '') return null;
  return String(value);
}

function assertOptions({ debounceMs, maxBatch, maxWaitMs }) {
  if (!Number.isInteger(debounceMs) || debounceMs < 0) {
    throw new Error('FORWARD_DEBOUNCE_MS deve essere un intero maggiore o uguale a 0');
  }
  if (!Number.isInteger(maxBatch) || maxBatch < 1) {
    throw new Error('FORWARD_MAX_BATCH deve essere un intero maggiore o uguale a 1');
  }
  if (!Number.isInteger(maxWaitMs) || maxWaitMs < 0) {
    throw new Error('FORWARD_MAX_WAIT_MS deve essere un intero maggiore o uguale a 0');
  }
}

export function createForwardBatcher({
  debounceMs = 120_000,
  maxBatch = 20,
  maxWaitMs = 600_000,
  botUserId = null,
  onFlush,
  onError,
} = {}) {
  if (typeof onFlush !== 'function') throw new Error('onFlush è obbligatorio');
  assertOptions({ debounceMs, maxBatch, maxWaitMs });

  const conversations = new Map();
  let stopped = false;
  let idle = Promise.resolve();

  function track(promise) {
    idle = Promise.allSettled([idle, promise]).then(() => {});
    return promise;
  }

  function pendingCount() {
    let count = 0;
    for (const state of conversations.values()) count += state.entries.length;
    return count;
  }

  function clearTimers(state) {
    if (state.debounceTimer) clearTimeout(state.debounceTimer);
    if (state.maxWaitTimer) clearTimeout(state.maxWaitTimer);
    state.debounceTimer = null;
    state.maxWaitTimer = null;
  }

  function take(key) {
    const state = conversations.get(key);
    if (!state) return null;
    conversations.delete(key);
    clearTimers(state);
    return state.entries;
  }

  function flushConversation(key, reason) {
    const entries = take(key);
    if (!entries || entries.length === 0) return Promise.resolve();
    let promise;
    try {
      promise = Promise.resolve(onFlush(entries, { key, reason }));
    } catch (error) {
      promise = Promise.reject(error);
    }
    const guarded = promise.catch((error) => {
      if (typeof onError === 'function') {
        onError(error, { key, reason, entries });
        return;
      }
      throw error;
    });
    return track(guarded);
  }

  function armDebounce(state, key) {
    if (state.debounceTimer) clearTimeout(state.debounceTimer);
    state.debounceTimer = setTimeout(() => {
      flushConversation(key, 'debounce');
    }, debounceMs);
  }

  function armMaxWait(state, key) {
    if (state.maxWaitTimer) return;
    const remaining = state.startedAt + maxWaitMs - Date.now();
    if (remaining <= 0) return;
    state.maxWaitTimer = setTimeout(() => {
      flushConversation(key, 'max_wait');
    }, remaining);
  }

  async function deliverNow(entry, key, reason) {
    let promise;
    try {
      promise = Promise.resolve(onFlush([entry], { key, reason }));
    } catch (error) {
      promise = Promise.reject(error);
    }
    const guarded = promise.catch((error) => {
      if (typeof onError === 'function') {
        onError(error, { key, reason, entries: [entry] });
        return;
      }
      throw error;
    });
    await track(guarded);
  }

  async function push(entry) {
    const ownId = resolveBotUserId(botUserId);
    if (ownId && isOwnMessage(entry, ownId)) {
      return { queued: false, reason: 'own' };
    }

    const key = entry?.key == null || entry.key === '' ? '' : String(entry.key);
    if (!key) return { queued: false, reason: 'incomplete' };

    if (stopped || debounceMs === 0) {
      const reason = stopped ? 'shutdown' : 'immediate';
      await deliverNow(entry, key, reason);
      return { queued: false, reason };
    }

    let state = conversations.get(key);
    if (!state) {
      state = {
        entries: [],
        startedAt: Date.now(),
        debounceTimer: null,
        maxWaitTimer: null,
      };
      conversations.set(key, state);
    }
    state.entries.push(entry);

    const reachedCap = state.entries.length >= maxBatch;
    const waitedTooLong = Date.now() - state.startedAt >= maxWaitMs;
    if (stopped || reachedCap || waitedTooLong) {
      const reason = stopped ? 'shutdown' : reachedCap ? 'max_batch' : 'max_wait';
      await flushConversation(key, reason);
      return { queued: false, reason };
    }

    armDebounce(state, key);
    armMaxWait(state, key);
    return { queued: true, reason: 'debounce', size: state.entries.length };
  }

  async function flushAll() {
    stopped = true;
    while (conversations.size > 0) {
      const keys = [...conversations.keys()];
      await Promise.all(keys.map((key) => flushConversation(key, 'shutdown')));
    }
  }

  return {
    push,
    flushAll,
    pendingCount,
    idle() {
      return idle;
    },
  };
}
