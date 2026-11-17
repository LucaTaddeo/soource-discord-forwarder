import { describeWebhookUrl, loadWebhookConfig } from '../src/config.js';
import { loadProjectEnv } from '../src/env.js';
import { addSecret, log } from '../src/log.js';
import { samplePayload } from '../src/payload.js';
import { deliverWebhook } from '../src/webhook.js';

loadProjectEnv(import.meta.url);

let webhook;
try {
  webhook = loadWebhookConfig();
} catch (error) {
  console.error(`[${new Date().toISOString()}] ERROR ${error.message}`);
  process.exit(1);
}

addSecret(webhook.authorization);
addSecret(webhook.webhookUrl);

const payload = samplePayload();
log('info', `Invio un payload di prova a ${describeWebhookUrl(webhook.webhookUrl)}`);
log('info', `Payload: ${JSON.stringify(payload)}`);

try {
  const result = await deliverWebhook({
    url: webhook.webhookUrl,
    authorization: webhook.authorization,
    payload,
  });
  if (result.ok) {
    log('info', `Webhook ok (${result.summary}) al tentativo ${result.attempts}`);
    process.exit(0);
  }
  log('error', `Webhook non raggiungibile dopo ${result.attempts} tentativi: ${result.summary}`);
  process.exit(1);
} catch (error) {
  log('error', `Invio di prova non riuscito: ${error.message}`);
  process.exit(1);
}
