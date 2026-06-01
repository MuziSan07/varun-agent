import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toE164, toWhatsApp, isValidE164 } from '../src/utils/phone.js';

test('toE164 normalises spacing and punctuation', () => {
  assert.equal(toE164('+91 98 123-456 78'), '+919812345678');
  assert.equal(toE164('+1 (415) 523-8886'), '+14155238886');
  assert.equal(toE164('whatsapp:+12223334444'), '+12223334444');
});

test('toE164 prefixes a bare digit string with +', () => {
  assert.equal(toE164('919812345678'), '+919812345678');
});

test('toWhatsApp prefixes correctly', () => {
  assert.equal(toWhatsApp('+12223334444'), 'whatsapp:+12223334444');
  assert.equal(toWhatsApp('whatsapp:+12223334444'), 'whatsapp:+12223334444');
});

test('isValidE164 validates', () => {
  assert.equal(isValidE164('+919812345678'), true);
  assert.equal(isValidE164('hello'), false);
  assert.equal(isValidE164('12345'), false); // 5 digits: too short, not prefixed
});
