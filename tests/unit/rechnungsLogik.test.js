import { test } from 'node:test';
import assert from 'node:assert/strict';
import { saetze, positionen, naechsteNummer, passendeRechnung, vormonat, empfaengerText } from '../../src/services/rechnungsLogik.js';

const t = (id, tag, status, extra = {}) => ({ id, beginn: new Date(2026, 10, tag, 15), ende: new Date(2026, 10, tag, 16), status, ...extra });

test('nur berechnete, noch nicht abgerechnete Termine, nach Datum', () => {
  const p = positionen([t(1, 20, 'stattgefunden'), t(2, 5, 'ausgefallen'), t(3, 6, 'abgesagt'), t(4, 7, 'geplant'), t(5, 8, 'unentschuldigt', { rechnung_id: 9 })], { stattgefunden: 5800, ausgefallen: 2900, unentschuldigt: 5800 });
  assert.deepEqual(p.map((x) => x.termin_id), [2, 1]);
  assert.equal(p[0].beschreibung, 'Lerntherapie 60 min (Ausfall, < 24 h abgesagt)');
  assert.equal(p[0].betrag_cent, 2900);
  assert.equal(p[1].betrag_cent, 5800);
  assert.equal(p[0].datum, '2026-11-05');
});

test('Rechnungsnummern laufen je Monat', () => {
  const d = new Date(2026, 11, 1);
  assert.equal(naechsteNummer([], d), '2026-12-001');
  assert.equal(naechsteNummer(['2026-12-001', '2026-12-009', '2026-11-050'], d), '2026-12-010');
});

test('Zahlungsabgleich über Nummer im Verwendungszweck und Betrag', () => {
  const offen = [{ id: 1, nummer: '2026-12-001', betrag_cent: 23200 }, { id: 2, nummer: '2026-12-002', betrag_cent: 11600 }];
  assert.equal(passendeRechnung({ betrag_cent: 11600, verwendungszweck: 'Rechnung 2026- 12-002 Max' }, offen).id, 2);
  assert.equal(passendeRechnung({ betrag_cent: 10000, verwendungszweck: 'RE 2026-12-002' }, offen), null);
  assert.equal(passendeRechnung({ betrag_cent: -11600, verwendungszweck: '2026-12-002' }, offen), null);
});

test('Vormonat über den Jahreswechsel', () => assert.equal(vormonat(new Date(2027, 0, 1)), '2026-12'));
test('Empfänger aus dem Zahler', () => assert.equal(empfaengerText({ name: 'Eva B', adresse: 'Weg 1\n12345 Ort' }), 'Eva B\nWeg 1\n12345 Ort'));
test('Positionstext mit Therapiebezeichnung', () => assert.equal(positionen([t(1, 3, 'stattgefunden')], { stattgefunden: 1 }, 'LRS-Therapie')[0].beschreibung, 'LRS-Therapie 60 min'));

import { naechsteMahnstufe, neueMahnung } from '../../src/services/rechnungsLogik.js';
const E = { karenzTage: 7, fristTage: 10, gebuehren: [0, 500, 1000] };
const re = { id: 1, status: 'offen', mahnstufe: 0, faellig_am: '2026-12-15' };

test('Erinnerung erst nach Fälligkeit + Karenz', () => {
  assert.equal(naechsteMahnstufe(re, null, E, new Date(2026, 11, 22)), null);
  assert.equal(naechsteMahnstufe(re, null, E, new Date(2026, 11, 23)), 1);
  assert.equal(naechsteMahnstufe({ ...re, status: 'bezahlt' }, null, E, new Date(2027, 1, 1)), null);
});
test('Folgestufe nach Ablauf der Mahnfrist, höchstens 3', () => {
  const m = { frist: '2027-01-02' };
  assert.equal(naechsteMahnstufe({ ...re, mahnstufe: 1 }, m, E, new Date(2027, 0, 9)), null);
  assert.equal(naechsteMahnstufe({ ...re, mahnstufe: 1 }, m, E, new Date(2027, 0, 10)), 2);
  assert.equal(naechsteMahnstufe({ ...re, mahnstufe: 3 }, m, E, new Date(2027, 5, 1)), null);
});
test('Mahnung mit Frist und Gebühr', () => assert.deepEqual(neueMahnung(re, 2, E, new Date(2027, 0, 10)), { rechnung_id: 1, stufe: 2, datum: '2027-01-10', frist: '2027-01-20', gebuehr_cent: 500 }));

test('Klientensatz überschreibt Standard, NULL = Standard', () => {
  const std = { stundensatz_cent: 5800, ausfall_cent: 4000, unentschuldigt_cent: 5800 };
  assert.deepEqual(saetze({ stundensatz_cent: 6200, ausfall_cent: null, unentschuldigt_cent: 0 }, std), { stattgefunden: 6200, ausgefallen: 4000, unentschuldigt: 0 });
});
test('Betrag 0 € erzeugt keine Position', () => {
  const p = positionen([t(1, 3, 'unentschuldigt'), t(2, 4, 'stattgefunden')], { stattgefunden: 5800, ausgefallen: 0, unentschuldigt: 0 });
  assert.deepEqual(p.map((x) => x.termin_id), [2]);
});
