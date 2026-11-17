import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import { addSecret, clearSecrets, log, redact } from '../src/log.js';

describe('redaction', () => {
  afterEach(() => {
    clearSecrets();
    mock.restoreAll();
  });

  it('removes the token and the Authorization value from log lines', () => {
    const token = 'BotToken.super.secret';
    const authorization = 'Bearer another-secret-value';
    addSecret(token);
    addSecret(authorization);

    assert.equal(redact(`login ${token} header ${authorization}`), 'login [redacted] header [redacted]');

    const error = mock.method(console, 'error', () => {});
    const info = mock.method(console, 'log', () => {});
    log('error', `fallito ${authorization}`);
    log('info', 'Modalità di inoltro: all');

    const errorLine = error.mock.calls[0].arguments[0];
    const infoLine = info.mock.calls[0].arguments[0];
    assert.equal(errorLine.includes(authorization), false);
    assert.match(errorLine, /\[redacted\]/);
    assert.match(infoLine, /INFO Modalità di inoltro: all/);
  });
});
