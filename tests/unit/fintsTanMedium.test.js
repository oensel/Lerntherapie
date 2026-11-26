import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setzeTanMedium } from '../../src/services/fintsTanMedium.js';

const config = (medien) => {
  const tm = { activeTanMedia: medien };
  return { selectedTanMethod: tm, tanMediaName: undefined,
    selectTanMedia(n) { if (!tm.activeTanMedia.includes(n)) throw new Error('nicht gefunden'); this.tanMediaName = n; } };
};

test('Name aus der Bankliste wird übernommen', () => {
  const c = config(['iPhone']); setzeTanMedium(c, 'iPhone'); assert.equal(c.tanMediaName, 'iPhone');
});
test('fehlt die Bankliste, wird der Name trotzdem gesetzt (z.B. "Alle Geräte")', () => {
  const c = config([]); setzeTanMedium(c, 'Alle Geräte'); assert.equal(c.tanMediaName, 'Alle Geräte');
});
test('ohne Namen bleibt alles unverändert', () => {
  const c = config([]); setzeTanMedium(c, ''); assert.equal(c.tanMediaName, undefined);
});
