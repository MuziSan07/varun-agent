import { test } from 'node:test';
import assert from 'node:assert/strict';
import { serviceStatus, getMode, setMode, isSandbox } from '../src/config.js';

test('serviceStatus reports missing vars without throwing', () => {
  const s = serviceStatus('twilio');
  assert.ok(Array.isArray(s.missing));
  // With empty .env, twilio should be unconfigured and name the exact vars.
  if (!s.configured) {
    assert.ok(s.missing.includes('TWILIO_ACCOUNT_SID') || s.missing.includes('TWILIO_AUTH_TOKEN'));
  }
});

test('mode toggle defaults to SANDBOX and is switchable', () => {
  assert.equal(getMode(), 'SANDBOX');
  assert.equal(isSandbox(), true);
  setMode('LIVE');
  assert.equal(getMode(), 'LIVE');
  setMode('SANDBOX');
  assert.equal(isSandbox(), true);
});

test('unknown service is reported, not thrown', () => {
  const s = serviceStatus('nope');
  assert.equal(s.configured, false);
});
