import { createServer } from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { log } from '../log.js';
import { isAuthorized } from './auth.js';
import { registerDiscordTools } from './tools.js';

const MCP_INSTRUCTIONS =
  "Ogni scrittura (messaggi, reazioni, pin, thread, messaggi diretti) è eseguita dall'account del bot Discord, non come l'utente che parla con l'assistente. Se GUILD_IDS è impostato, i tool vedono solo quei server. edit_message e delete_message rifiutano i messaggi che non ha inviato il bot.";

function pathnameOf(req) {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  const path = url.pathname.replace(/\/+$/, '');
  return path || '/';
}

function sendJson(res, status, body, extraHeaders = {}) {
  const payload = body == null ? '' : JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
    ...extraHeaders,
  });
  res.end(payload);
}

function discordReady(client) {
  if (!client) return false;
  if (typeof client.isReady === 'function') return Boolean(client.isReady());
  return Boolean(client.user);
}

export function buildMcpServer(client, config, version = '1.0.0') {
  const server = new McpServer(
    { name: 'soource-discord', version },
    { instructions: MCP_INSTRUCTIONS },
  );
  registerDiscordTools(server, client, config);
  return server;
}

async function handleMcp(req, res, client, config) {
  const server = buildMcpServer(client, config);
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  let settled = false;
  const settle = () => {
    if (settled) return Promise.resolve();
    settled = true;
    return Promise.allSettled([transport.close(), server.close()]);
  };
  res.on('close', () => {
    settle();
  });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res);
  } catch (error) {
    log('error', `Richiesta MCP non riuscita: ${error instanceof Error ? error.message : String(error)}`);
    if (!res.headersSent) sendJson(res, 500, { error: 'Internal error' });
  } finally {
    await settle();
  }
}

export function createHttpServer({ client, config }) {
  const mcpEnabled = Boolean(config.mcpApiKey);
  return createServer((req, res) => {
    handleHttp(req, res, client, config, mcpEnabled).catch((error) => {
      log('error', `Errore HTTP: ${error instanceof Error ? error.message : String(error)}`);
      if (!res.headersSent) {
        try {
          sendJson(res, 500, { error: 'Internal error' });
        } catch {
          res.destroy();
        }
      }
    });
  });
}

async function handleHttp(req, res, client, config, mcpEnabled) {
  const path = pathnameOf(req);
  if (path === '/health') {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      sendJson(res, 405, { error: 'Method not allowed' });
      return;
    }
    sendJson(res, 200, req.method === 'HEAD' ? null : { ok: true, discord: discordReady(client), mcp: mcpEnabled });
    return;
  }

  if (path !== '/mcp') {
    sendJson(res, 404, { error: 'Not found' });
    return;
  }
  if (!mcpEnabled) {
    sendJson(res, 404, { error: 'MCP non attivo' });
    return;
  }
  if (!isAuthorized(req.headers.authorization, config.mcpApiKey)) {
    sendJson(res, 401, { error: 'Unauthorized' }, { 'WWW-Authenticate': 'Bearer' });
    return;
  }
  if (req.method !== 'POST' && req.method !== 'GET' && req.method !== 'DELETE') {
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }
  await handleMcp(req, res, client, config);
}

export function startHttpServer({ client, config, host = '0.0.0.0' }) {
  if (!config || !Number.isInteger(config.port)) {
    return Promise.reject(new Error('Porta HTTP mancante'));
  }
  const server = createHttpServer({ client, config });
  server.on('clientError', (_error, socket) => {
    if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
  });
  return new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off('error', onError);
      reject(error);
    };
    server.once('error', onError);
    server.listen(config.port, host, () => {
      server.off('error', onError);
      server.on('error', (error) => {
        log('error', `Errore del server HTTP: ${error.message}`);
      });
      resolve(server);
    });
  });
}

export function closeHttpServer(server) {
  if (!server) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, 2000);
    timer.unref?.();
    server.close(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}
