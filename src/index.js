import { Client, Events, GatewayIntentBits, Partials } from 'discord.js';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createForwardBatcher, isOwnMessage } from './batch.js';
import { describeWebhookUrl, loadConfig } from './config.js';
import { loadProjectEnv } from './env.js';
import { evaluateMessage } from './evaluate.js';
import { addSecret, log } from './log.js';
import { createOwnerCache } from './ownerCache.js';
import { closeHttpServer, startHttpServer } from './mcp/http.js';
import { buildBatchPayload } from './payload.js';
import { deliverWebhook } from './webhook.js';

process.title = 'soource-discord-forwarder';

export const DISCORD_CLIENT_OPTIONS = {
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
  partials: [Partials.Channel],
};

export function buildClientOptions(mcpEnabled = false) {
  if (!mcpEnabled) return DISCORD_CLIENT_OPTIONS;
  return {
    intents: [...DISCORD_CLIENT_OPTIONS.intents, GatewayIntentBits.GuildMembers],
    partials: [...DISCORD_CLIENT_OPTIONS.partials],
  };
}

function assertNodeVersion() {
  const major = Number(process.versions.node.split('.')[0]);
  if (!Number.isInteger(major) || major < 22) {
    console.error(
      `[${new Date().toISOString()}] ERROR Serve Node.js 22 o successivo (ora: ${process.versions.node}).`,
    );
    process.exit(1);
  }
}

function loginHint(message) {
  if (/disallowed intent/i.test(message)) {
    return ' Attiva Message Content Intent nel Developer Portal (Bot → Privileged Gateway Intents) e riavvia. Se MCP_API_KEY è impostata, attiva anche Server Members Intent.';
  }
  if (/invalid token/i.test(message)) {
    return ' Controlla DISCORD_TOKEN: deve essere il token del bot, non il Client Secret.';
  }
  return '';
}

function logStartup(readyClient, config) {
  const user = readyClient.user;
  const name = user?.tag || user?.username || 'bot';
  log('info', `Connesso come ${name} (${user?.id ?? '?'})`);
  if (config.ownerUserId) {
    log('info', `Owner: ${config.ownerUserId} (i messaggi di questo utente vengono ignorati)`);
  } else {
    log('info', 'Owner: non impostato');
  }
  log('info', config.guildIds ? `Filtro server: ${[...config.guildIds].join(', ')}` : 'Filtro server: tutti');
  log(
    'info',
    config.channelIds
      ? `Filtro canali: ${[...config.channelIds].join(', ')} (i messaggi diretti passano sempre)`
      : 'Filtro canali: tutti',
  );
  if (config.forwardMode === 'mentions' && !config.ownerUserId) {
    log('warn', 'FORWARD_MODE=mentions senza OWNER_USER_ID: verranno inoltrati solo i messaggi diretti');
  }

  const guilds = [...readyClient.guilds.cache.values()].sort((left, right) =>
    left.name.localeCompare(right.name, 'it'),
  );
  log('info', `Server visibili (${guilds.length}):`);
  if (guilds.length === 0) {
    log('warn', 'Nessun server. Invita il bot con il link descritto nel README.');
  }
  for (const guild of guilds) {
    const outside = config.guildIds && !config.guildIds.has(guild.id);
    log('info', `  • ${guild.name} (${guild.id})${outside ? ' — fuori dal filtro GUILD_IDS' : ''}`);
  }
  if (config.guildIds) {
    for (const id of config.guildIds) {
      if (!readyClient.guilds.cache.has(id)) {
        log('warn', `GUILD_IDS include ${id}, ma il bot non risulta in quel server`);
      }
    }
  }
}

export async function main() {
  assertNodeVersion();
  loadProjectEnv(import.meta.url);

  let config;
  try {
    config = loadConfig();
  } catch (error) {
    console.error(`[${new Date().toISOString()}] ERROR ${error.message}`);
    process.exit(1);
  }

  addSecret(config.token);
  addSecret(config.authorization);
  addSecret(config.webhookUrl);
  if (config.mcpApiKey) addSecret(config.mcpApiKey);

  const client = new Client(buildClientOptions(Boolean(config.mcpApiKey)));

  const ownerCache = createOwnerCache();
  const warnedGuilds = new Set();
  let ready = false;
  let shuttingDown = false;
  let activeHandlers = 0;
  let activeDeliveries = 0;
  let httpServer;

  const batcher = createForwardBatcher({
    debounceMs: config.forwardDebounceMs,
    maxBatch: config.forwardMaxBatch,
    maxWaitMs: config.forwardMaxWaitMs,
    botUserId: () => client.user?.id ?? null,
    onFlush: (entries) => deliverBatch(entries),
  });

  async function fetchOwnerMember(guildId, ownerUserId) {
    return ownerCache.get(`${guildId}:${ownerUserId}`, async () => {
      const guild = client.guilds.cache.get(String(guildId));
      if (!guild) return null;
      try {
        const member = await guild.members.fetch(String(ownerUserId));
        return { roleIds: [...member.roles.cache.keys()].map(String) };
      } catch (error) {
        if (!warnedGuilds.has(String(guildId))) {
          warnedGuilds.add(String(guildId));
          log(
            'warn',
            `Non riesco a leggere i ruoli dell'owner nel server ${guildId} (${error.message}). Le menzioni dei ruoli e di @everyone potrebbero non essere riconosciute.`,
          );
        }
        return { roleIds: [], missing: true };
      }
    });
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function shutdown(signal, code = 0) {
    if (shuttingDown) return;
    shuttingDown = true;
    log('info', `Arresto in corso (${signal})`);
    const deadline = Date.now() + 8000;
    try {
      while (activeHandlers > 0 && Date.now() < deadline) {
        await sleep(50);
      }
      const pending = batcher.pendingCount();
      if (pending > 0) {
        log('info', `Invio di ${pending} messaggi in attesa prima dell'arresto`);
      }
      await Promise.race([batcher.flushAll(), sleep(Math.max(0, deadline - Date.now()))]);
    } catch (error) {
      log('error', `Errore durante l'invio dei messaggi in attesa: ${error.message}`);
    }
    try {
      await closeHttpServer(httpServer);
    } catch (error) {
      log('error', `Errore durante la chiusura del server HTTP: ${error.message}`);
    }
    while (activeDeliveries > 0 && Date.now() < deadline) {
      await sleep(100);
    }
    if (activeDeliveries > 0) {
      log('warn', `Arresto con ${activeDeliveries} invii ancora in corso`);
    }
    try {
      client.destroy();
    } catch (error) {
      log('error', `Errore durante la chiusura della connessione Discord: ${error.message}`);
    }
    process.exit(code);
  }

  client.once(Events.ClientReady, (readyClient) => {
    ready = true;
    logStartup(readyClient, config);
  });

  client.on(Events.GuildCreate, (guild) => {
    if (!ready) return;
    log('info', `Il bot è stato aggiunto al server ${guild.name} (${guild.id})`);
  });
  client.on(Events.GuildDelete, (guild) => {
    log('info', `Il bot non è più nel server ${guild?.name ?? '?'} (${guild?.id ?? '?'})`);
  });
  client.on(Events.GuildUnavailable, (guild) => {
    log('warn', `Server temporaneamente non disponibile: ${guild?.name ?? '?'} (${guild?.id ?? '?'})`);
  });
  client.on(Events.GuildAvailable, (guild) => {
    if (!ready) return;
    log('info', `Server di nuovo disponibile: ${guild.name} (${guild.id})`);
  });
  client.on(Events.Error, (error) => {
    log('error', `Errore del client Discord: ${error.message}`);
  });
  client.on(Events.Warn, (message) => {
    log('warn', `Discord: ${message}`);
  });
  client.on(Events.ShardDisconnect, () => {
    log('warn', 'Connessione a Discord interrotta, riconnessione in corso');
  });
  client.on(Events.ShardReconnecting, () => {
    log('info', 'Riconnessione a Discord in corso');
  });
  client.on(Events.ShardResume, () => {
    log('info', 'Connessione a Discord ripristinata');
  });
  client.on(Events.ShardError, (error) => {
    log('error', `Errore di connessione Discord: ${error.message}`);
  });
  client.on(Events.Invalidated, () => {
    log('error', 'Sessione Discord invalidata. Controlla il token e riavvia.');
    shutdown('invalidated', 1);
  });

  client.on(Events.MessageCreate, (message) => {
    handleMessage(message).catch((error) => {
      log('error', `Errore imprevisto sul messaggio ${message?.id ?? '?'}: ${error.message}`);
    });
  });

  async function deliverBatch(entries) {
    activeDeliveries += 1;
    try {
      const payload = buildBatchPayload(entries);
      const result = await deliverWebhook({
        url: config.webhookUrl,
        authorization: config.authorization,
        payload,
      });
      const where = payload.is_dm ? 'DM' : `${payload.server ?? '?'} / #${payload.channel}`;
      if (result.ok) {
        if (payload.message_count === 1) {
          const only = entries[0];
          log(
            'info',
            `Inoltrato messaggio ${only?.messageId ?? '?'} da ${payload.author} in ${where} (HTTP ${result.status})`,
          );
        } else {
          log('info', `Inoltrati ${payload.message_count} messaggi in ${where} (HTTP ${result.status})`);
        }
      } else {
        const ids = entries.map((entry) => entry.messageId ?? '?').join(', ');
        log(
          'error',
          `Invio non riuscito per ${entries.length} messaggi (${ids}) dopo ${result.attempts} tentativi: ${result.summary}`,
        );
      }
    } catch (error) {
      log('error', `Invio non riuscito: ${error.message}`);
    } finally {
      activeDeliveries -= 1;
    }
  }

  async function handleMessage(message) {
    if (shuttingDown) return;
    if (isOwnMessage(message, client.user?.id)) return;
    activeHandlers += 1;
    try {
      const decision = await evaluateMessage(message, config, {
        fetchReference: (current) => current.fetchReference(),
        fetchOwnerMember,
      });
      if (!decision.forward || !decision.entry) return;
      await batcher.push(decision.entry);
    } finally {
      activeHandlers -= 1;
    }
  }

  process.on('SIGINT', () => {
    shutdown('SIGINT');
  });
  process.on('SIGTERM', () => {
    shutdown('SIGTERM');
  });
  process.on('unhandledRejection', (error) => {
    const message = error instanceof Error ? error.message : String(error);
    log('error', `Promessa non gestita: ${message}`);
  });
  process.on('uncaughtException', (error) => {
    log('error', `Eccezione non gestita: ${error.message}`);
    shutdown('uncaughtException', 1);
  });

  try {
    httpServer = await startHttpServer({ client, config });
  } catch (error) {
    log('error', `Impossibile aprire la porta ${config.port}: ${error.message}`);
    process.exit(1);
  }

  log('info', 'Avvio del bot');
  log('info', `Modalità di inoltro: ${config.forwardMode}`);
  if (config.forwardDebounceMs === 0) {
    log('info', 'Raggruppamento messaggi: disattivato (FORWARD_DEBOUNCE_MS=0)');
  } else {
    log(
      'info',
      `Raggruppamento messaggi: ${config.forwardDebounceMs} ms di silenzio, massimo ${config.forwardMaxBatch} messaggi o ${config.forwardMaxWaitMs} ms`,
    );
  }
  log('info', `Webhook: ${describeWebhookUrl(config.webhookUrl)}`);
  log('info', `Server HTTP in ascolto sulla porta ${config.port}`);
  if (config.mcpApiKey) {
    log('info', 'Endpoint MCP attivo: POST /mcp');
    if (config.mcpApiKey.length < 16) {
      log('warn', 'MCP_API_KEY è molto corta: generane una con almeno 32 byte casuali');
    }
    if (!config.allowWrite) {
      log('info', 'ALLOW_WRITE=false: i tool di scrittura non sono registrati');
    }
  } else {
    log('warn', 'MCP_API_KEY non impostata: il server MCP non viene avviato');
  }

  try {
    await client.login(config.token);
  } catch (error) {
    log('error', `Accesso a Discord non riuscito: ${error.message}${loginHint(error.message)}`);
    process.exit(1);
  }
}

function isDirectRun() {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(resolve(entry)).href;
}

if (isDirectRun()) {
  main().catch((error) => {
    console.error(`[${new Date().toISOString()}] ERROR ${error.message}`);
    process.exit(1);
  });
}
