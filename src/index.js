import { Client, Events, GatewayIntentBits, Partials } from 'discord.js';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describeWebhookUrl, loadConfig } from './config.js';
import { loadProjectEnv } from './env.js';
import { evaluateMessage } from './evaluate.js';
import { addSecret, log } from './log.js';
import { createOwnerCache } from './ownerCache.js';
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
    return ' Attiva Message Content Intent nel Developer Portal (Bot → Privileged Gateway Intents) e riavvia.';
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

  const client = new Client(DISCORD_CLIENT_OPTIONS);

  const ownerCache = createOwnerCache();
  const warnedGuilds = new Set();
  let ready = false;
  let shuttingDown = false;
  let activeDeliveries = 0;

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

  async function shutdown(signal, code = 0) {
    if (shuttingDown) return;
    shuttingDown = true;
    log('info', `Arresto in corso (${signal})`);
    const deadline = Date.now() + 8000;
    while (activeDeliveries > 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
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

  async function handleMessage(message) {
    if (shuttingDown) return;
    activeDeliveries += 1;
    try {
      const decision = await evaluateMessage(message, config, {
        fetchReference: (current) => current.fetchReference(),
        fetchOwnerMember,
      });
      if (!decision.forward || shuttingDown) return;

      const result = await deliverWebhook({
        url: config.webhookUrl,
        authorization: config.authorization,
        payload: decision.payload,
      });
      if (result.ok) {
        const where = decision.payload.is_dm
          ? 'DM'
          : `${decision.payload.server ?? '?'} / #${decision.payload.channel}`;
        log(
          'info',
          `Inoltrato messaggio ${message.id} da ${decision.payload.author} in ${where} (HTTP ${result.status})`,
        );
      } else {
        log(
          'error',
          `Invio non riuscito per il messaggio ${message.id} dopo ${result.attempts} tentativi: ${result.summary}`,
        );
      }
    } finally {
      activeDeliveries -= 1;
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

  log('info', 'Avvio del bot');
  log('info', `Modalità di inoltro: ${config.forwardMode}`);
  log('info', `Webhook: ${describeWebhookUrl(config.webhookUrl)}`);

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
