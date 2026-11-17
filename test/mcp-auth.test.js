import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { extractBearerToken, isAuthorized, timingSafeStringEqual } from '../src/mcp/auth.js';
import { closeHttpServer, startHttpServer } from '../src/mcp/http.js';

const KEY = 'test-mcp-key-value';

function clientWithGuild({ ready = false } = {}) {
  let toolTouched = false;
  const guilds = new Map([['10', { id: '10', name: 'Soource', memberCount: 3 }]]);
  return {
    toolTouched: () => toolTouched,
    client: {
      user: { id: 'bot' },
      isReady: () => ready,
      guilds: {
        cache: guilds,
        fetch: async () => {
          toolTouched = true;
          return guilds;
        },
      },
    },
  };
}

async function withServer(config, client, fn) {
  const server = await startHttpServer({
    client,
    host: '127.0.0.1',
    config: {
      port: 0,
      mcpApiKey: KEY,
      allowWrite: true,
      guildIds: null,
      ...config,
    },
  });
  try {
    await fn(server.address().port);
  } finally {
    await closeHttpServer(server);
  }
}

async function request(port, path, { method = 'GET', token, body, headers = {} } = {}) {
  const finalHeaders = { ...headers };
  if (token !== undefined) finalHeaders.Authorization = token;
  if (body !== undefined) {
    finalHeaders['Content-Type'] = 'application/json';
    finalHeaders.Accept = finalHeaders.Accept ?? 'application/json, text/event-stream';
  }
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers: finalHeaders,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let json = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
  }
  return { status: response.status, text, json };
}

const initialize = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2025-11-25',
    capabilities: {},
    clientInfo: { name: 'test', version: '0.0.0' },
  },
};

describe('MCP bearer auth', () => {
  it('compares equal strings and rejects different lengths without throwing', () => {
    assert.equal(timingSafeStringEqual('same-key', 'same-key'), true);
    assert.equal(timingSafeStringEqual('same-key', 'other-key'), false);
    assert.equal(timingSafeStringEqual('short', 'a-much-longer-secret'), false);
    assert.equal(extractBearerToken('Bearer secret-token'), 'secret-token');
    assert.equal(extractBearerToken('bearer\tsecret-token'), 'secret-token');
    assert.equal(extractBearerToken('Basic secret-token'), null);
    assert.equal(extractBearerToken(['Bearer secret-token']), null);
    assert.equal(isAuthorized('Bearer secret-token', 'secret-token'), true);
    assert.equal(isAuthorized('Bearer secret', 'secret-token'), false);
    assert.equal(isAuthorized('Bearer secret-token-extra', 'secret-token'), false);
    assert.equal(isAuthorized(undefined, 'secret-token'), false);
    assert.equal(isAuthorized('Bearer secret-token', ''), false);
  });

  it('serves /health without auth and keeps /mcp closed when the key is unset', async () => {
    const { client } = clientWithGuild();
    await withServer({ mcpApiKey: null }, client, async (port) => {
      const health = await request(port, '/health');
      assert.equal(health.status, 200);
      assert.equal(health.json.ok, true);
      assert.equal(health.json.mcp, false);
      assert.equal(health.json.discord, false);
      const wrongAuth = await request(port, '/health?ready=1', { token: 'Bearer nope' });
      assert.equal(wrongAuth.status, 200);
      const head = await request(port, '/health', { method: 'HEAD' });
      assert.equal(head.status, 200);
      assert.equal(head.text, '');
      const posted = await request(port, '/health', { method: 'POST', body: {} });
      assert.equal(posted.status, 405);
      const mcp = await request(port, '/mcp', { method: 'POST', token: `Bearer ${KEY}`, body: initialize });
      assert.equal(mcp.status, 404);
      assert.equal(mcp.json.error, 'MCP non attivo');
    });
  });

  it('rejects missing, malformed and wrong bearer tokens before any Discord call', async () => {
    const probe = clientWithGuild({ ready: true });
    await withServer({}, probe.client, async (port) => {
      const call = {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: 'list_guilds', arguments: {} },
      };
      const missing = await request(port, '/mcp', { method: 'POST', body: call });
      const basic = await request(port, '/mcp', { method: 'POST', token: `Basic ${KEY}`, body: call });
      const wrong = await request(port, '/mcp', { method: 'POST', token: 'Bearer not-the-key', body: call });
      const prefix = await request(port, '/mcp', { method: 'POST', token: 'Bearer test-mcp-key', body: call });
      for (const response of [missing, basic, wrong, prefix]) {
        assert.equal(response.status, 401);
        assert.equal(response.json.error, 'Unauthorized');
        assert.equal(response.text.includes(KEY), false);
        assert.equal(response.text.includes('not-the-key'), false);
      }
      assert.equal(probe.toolTouched(), false);
      const other = await request(port, '/status', { token: `Bearer ${KEY}` });
      assert.equal(other.status, 404);
    });
  });

  it('accepts the bearer token and serves stateless MCP on the shared client', async () => {
    const probe = clientWithGuild({ ready: true });
    await withServer({}, probe.client, async (port) => {
      const opened = await request(port, '/mcp', { method: 'POST', token: `Bearer ${KEY}`, body: initialize });
      assert.equal(opened.status, 200);
      assert.equal(opened.json.result.serverInfo.name, 'soource-discord');
      assert.match(opened.json.result.instructions, /account del bot/);
      assert.equal(opened.json.result.instructions.includes(KEY), false);

      const listed = await request(port, '/mcp', {
        method: 'POST',
        token: `Bearer ${KEY}`,
        body: { jsonrpc: '2.0', id: 3, method: 'tools/list', params: {} },
      });
      assert.equal(listed.status, 200);
      const names = listed.json.result.tools.map((tool) => tool.name);
      assert.ok(names.includes('list_guilds'));
      assert.ok(names.includes('send_message'));
      const send = listed.json.result.tools.find((tool) => tool.name === 'send_message');
      assert.match(send.description, /non come l'utente/);

      const called = await request(port, '/mcp', {
        method: 'POST',
        token: `Bearer ${KEY}`,
        body: {
          jsonrpc: '2.0',
          id: 4,
          method: 'tools/call',
          params: { name: 'list_guilds', arguments: {} },
        },
      });
      assert.equal(called.status, 200);
      assert.notEqual(called.json.result.isError, true);
      const payload = JSON.parse(called.json.result.content[0].text);
      assert.equal(payload.guilds[0].name, 'Soource');
      assert.equal(probe.toolTouched(), true);
    });
  });

  it('omits write tools when ALLOW_WRITE is false', async () => {
    const { client } = clientWithGuild();
    await withServer({ allowWrite: false }, client, async (port) => {
      const listed = await request(port, '/mcp', {
        method: 'POST',
        token: `Bearer ${KEY}`,
        body: { jsonrpc: '2.0', id: 5, method: 'tools/list', params: {} },
      });
      const names = listed.json.result.tools.map((tool) => tool.name);
      assert.ok(names.includes('read_messages'));
      assert.equal(names.includes('send_message'), false);
      assert.equal(names.includes('send_dm'), false);
      assert.equal(names.includes('delete_message'), false);
      const health = await request(port, '/health');
      assert.equal(health.json.mcp, true);
    });
  });
});
