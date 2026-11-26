import { test } from 'node:test';
import assert from 'node:assert/strict';
import { positionen, naechsteNummer, passendeRechnung, vormonat, empfaengerText } from '../../src/services/rechnungsLogik.js';

const t = (id, tag, status, extra = {}) => ({ id, beginn: new Date(2026, 10, tag, 15), ende: new Date(2026, 10, tag, 16), status, ...extra });

test('nur berechnete, noch nicht abgerechnete Termine, nach Datum', () => {
  const p = positionen([t(1, 20, 'stattgefunden'), t(2, 5, 'ausgefallen'), t(3, 6, 'abgesagt'), t(4, 7, 'geplant'), t(5, 8, 'unentschuldigt', { rechnung_id: 9 })], 5800);
  assert.deepEqual(p.map((x) => x.termin_id), [2, 1]);
  assert.equal(p[0].beschreibung, 'Lerntherapie 60 min (Ausfall, < 24 h abgesagt)');
  assert.equal(p[0].betrag_cent, 5800);
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
test('Empfänger', () => assert.equal(empfaengerText({ vorname: 'A', nachname: 'B', sorgeberechtigte: 'Eva B', adresse: 'Weg 1\n12345 Ort', kostentraeger: 'eltern' }), 'Eva B\nWeg 1\n12345 Ort'));
