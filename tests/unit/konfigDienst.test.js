import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { verschluesseln, entschluesseln } from '../../src/services/konfigDienst.js';

const key = crypto.randomBytes(32);
test('Geheimnis wird verschlüsselt und wieder gelesen', () => {
  const v = verschluesseln('geheimes Passwort äöü', key);
  assert.ok(!v.includes('geheim'));
  assert.equal(entschluesseln(v, key), 'geheimes Passwort äöü');
});
test('falscher Schlüssel schlägt fehl', () => assert.throws(() => entschluesseln(verschluesseln('x', key), crypto.randomBytes(32))));
