import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bildeUmsaetze, alsDatum } from '../../src/services/umsatzAbbildung.js';

const b = (o = {}) => ({ entryDate: new Date(2026, 10, 20), valueDate: new Date(2026, 10, 20), amount: 58, remoteName: 'Sandra Becker',
  remoteAccountNumber: 'DE02120300000000202051', purpose: 'Rechnung 2026-11-002', bankReference: 'NONREF', ...o });

test('Betrag in Cent, Datum lokal, Felder getrimmt', () => {
  const [z] = bildeUmsaetze('DE1', [b({ amount: -12.35, remoteName: ' Büro ' })]);
  assert.equal(z.betrag_cent, -1235);
  assert.equal(z.buchungsdatum, '2026-11-20');
  assert.equal(z.gegen_name, 'Büro');
});

test('gleiche Buchungen in einem Abruf bleiben getrennt, überlappender Abruf ergibt dieselben Fingerabdrücke', () => {
  const erst = bildeUmsaetze('DE1', [b(), b()]);
  assert.notEqual(erst[0].fingerabdruck, erst[1].fingerabdruck);
  const zweit = bildeUmsaetze('DE1', [b({ amount: 10, purpose: 'anders' }), b(), b()]);
  assert.deepEqual(zweit.slice(1).map((z) => z.fingerabdruck), erst.map((z) => z.fingerabdruck));
});

test('alsDatum ohne Wert', () => assert.equal(alsDatum(undefined), null));
