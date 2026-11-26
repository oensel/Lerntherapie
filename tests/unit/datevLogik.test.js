import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aufteilen, buchungen, datevCsv, konten, vorgaben, alsAnsi } from '../../src/services/datevLogik.js';

test('Zahlung auf Honorar, Ausfall und Sonstiges aufteilen', () => {
  const pos = [{ art: 'honorar', betrag_cent: 12000 }, { art: 'ausfall', betrag_cent: 3000 }];
  assert.deepEqual(aufteilen(15000, pos), { honorar: 12000, ausfall: 3000, sonst: 0 });
  assert.deepEqual(aufteilen(15500, pos), { honorar: 12000, ausfall: 3000, sonst: 500 });
  assert.deepEqual(aufteilen(2000, pos), { honorar: 0, ausfall: 2000, sonst: 0 });
});

test('Konten: Eingetragenes vor Vorschlag, SKR04 wählbar', () => {
  assert.equal(vorgaben('03').DATEV_BANK, '1200');
  const k = konten({ DATEV_KONTENRAHMEN: '04', DATEV_ERLOES: ' 4110 ' });
  assert.equal(k.skr, '04'); assert.equal(k.DATEV_BANK, '1800'); assert.equal(k.DATEV_ERLOES, '4110');
});

test('Buchungen und CSV im DATEV-Format', () => {
  const kt = konten({});
  const bs = buchungen({
    einnahmen: [{ datum: '2026-03-05', nummer: '2026-02-001', text: 'Mia Muster 02/2026', gezahlt_cent: 15500, positionen: [{ art: 'honorar', betrag_cent: 15000 }] }],
    ausgaben: [{ datum: '2026-01-10', beleg: 'R-77', lieferant: 'Verlag', posten: [{ beschreibung: 'Buch "Lesen"', betrag_cent: 2490, kategorie: 'Fachliteratur' }] }],
  }, kt);
  assert.deepEqual(bs.map((b) => [b.soll, b.haben, b.betrag_cent]), [['4940', '1200', 2490], ['1200', '8100', 15000], ['1200', '2700', 500]]);
  const csv = datevCsv({ jahr: 2026, buchungen: bs, berater: '1001', mandant: '42', skr: '03', jetzt: new Date('2026-11-26T10:00:00Z') });
  const z = csv.split('\r\n');
  assert.match(z[0], /^"EXTF";700;21;"Buchungsstapel";13;20261126100000000;.*;1001;42;20260101;4;20260101;20261231;/);
  assert.equal(z[2], '24,90;"S";"EUR";;;"";4940;1200;"";1001;"R-77";"";;"Verlag: Buch ""Lesen"""');
  assert.equal(z.length, 6);
});

test('ANSI-Kodierung ersetzt Zeichen außerhalb von Latin-1', () => {
  assert.deepEqual([...alsAnsi('ä–€')], [0xe4, 0x2d, 0x45, 0x55, 0x52]);
});
