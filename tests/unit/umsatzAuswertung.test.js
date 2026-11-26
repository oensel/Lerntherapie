import test from 'node:test';
import assert from 'node:assert/strict';
import { monatsSummen, kontoverlauf } from '../../src/services/umsatzAuswertung.js';

const U = [
  { buchungsdatum: '2026-09-03', betrag_cent: 11600 },
  { buchungsdatum: '2026-09-10', betrag_cent: -2000 },
  { buchungsdatum: '2026-11-02', betrag_cent: 5800 },
  { buchungsdatum: '2026-11-02', betrag_cent: -800 },
];

test('Monatssummen ohne Lücken', () => {
  assert.deepEqual(monatsSummen(U), [
    { monat: '2026-09', ein_cent: 11600, aus_cent: 2000 },
    { monat: '2026-10', ein_cent: 0, aus_cent: 0 },
    { monat: '2026-11', ein_cent: 5800, aus_cent: 800 },
  ]);
  assert.deepEqual(monatsSummen([]), []);
});

test('Monatssummen über den Jahreswechsel', () => {
  assert.deepEqual(monatsSummen([{ buchungsdatum: '2026-12-01', betrag_cent: 1 }, { buchungsdatum: '2027-01-01', betrag_cent: 1 }]).map((m) => m.monat), ['2026-12', '2027-01']);
});

test('Kontoverlauf rückwärts vom Schlusssaldo', () => {
  assert.deepEqual(kontoverlauf(U, 100000, '2026-11-20'), [
    { datum: '2026-09-03', saldo_cent: 100000 - 5000 + 2000 },
    { datum: '2026-09-10', saldo_cent: 95000 },
    { datum: '2026-11-02', saldo_cent: 100000 },
    { datum: '2026-11-20', saldo_cent: 100000 },
  ]);
  assert.equal(kontoverlauf(U, null, null), null);
});
