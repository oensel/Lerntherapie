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

test('Zahlungsabgleich über Nachname und genauen Betrag', () => {
  const offen = [
    { id: 1, nummer: '2026-12-001', betrag_cent: 23200, klient_name: 'Max Müller', empfaenger: 'Eva Müller\nWeg 1' },
    { id: 2, nummer: '2026-12-002', betrag_cent: 11600, klient_name: 'Lina Schmidt', empfaenger: 'Jugendamt Borken\nStr. 2' },
    { id: 3, nummer: '2026-12-003', betrag_cent: 11600, klient_name: 'Tom Schmidt', empfaenger: 'Anna Schmidt' },
  ];
  assert.equal(passendeRechnung({ betrag_cent: 23200, verwendungszweck: 'Lerntherapie Max', gegen_name: 'MUELLER, EVA' }, offen).id, 1);
  assert.equal(passendeRechnung({ betrag_cent: 23300, verwendungszweck: 'Mueller' }, offen), null); // Betrag weicht ab
  assert.equal(passendeRechnung({ betrag_cent: 11600, verwendungszweck: 'Schmidt Dezember' }, offen), null); // nicht eindeutig
  assert.equal(passendeRechnung({ betrag_cent: 11600, verwendungszweck: 'Rechnung', gegen_name: 'Kreis Borken' }, offen).id, 2);
  assert.equal(passendeRechnung({ betrag_cent: 11600, verwendungszweck: 'Schmidtke' }, offen), null); // nur ganze Wörter
});

test('Terminart: anteiliger Preis nach realer Dauer', async () => {
  const { artBetrag, positionen } = await import('../../src/services/rechnungsLogik.js');
  const t = { id: 9, status: 'stattgefunden', beginn: '2026-11-03T14:00:00', ende: '2026-11-03T15:15:00', terminart_name: 'Therapiestunde', geplante_dauer_min: 60, preis_cent: 6000 };
  assert.equal(artBetrag(t), 7500);
  const satz = { stattgefunden: 5800, ausgefallen: 3000, unentschuldigt: 5800 };
  const [p] = positionen([t], satz, 'Lerntherapie');
  assert.equal(p.betrag_cent, 7500);
  assert.equal(p.beschreibung, 'Therapiestunde 75 min');
  // Ausfall mit Terminart: Ausfallbetrag der Therapie; ohne Art: Stundensatz
  assert.equal(positionen([{ ...t, status: 'ausgefallen' }], satz)[0].betrag_cent, 3000);
  assert.equal(positionen([{ ...t, preis_cent: null }], satz)[0].betrag_cent, 5800);
});

test('Verlauf einer Rechnung: Erstellung, Versand, Frist, Mahnung, nächster Schritt', async () => {
  const { rechnungsVerlauf } = await import('../../src/services/rechnungsLogik.js');
  const re = { status: 'offen', mahnstufe: 1, erstellt_am: '2026-10-03T06:00:00', rechnungsdatum: '2026-10-03', faellig_am: '2026-10-17' };
  const mahnungen = [{ id: 5, stufe: 1, datum: '2026-10-25', frist: '2026-11-04', gebuehr_cent: 0, erstellt_am: '2026-10-25T09:00:00' }];
  const versand = [{ gesendet_am: '2026-10-03T08:00:00', an: 'eltern@example.org' }, { gesendet_am: '2026-10-25T09:05:00', an: 'eltern@example.org', mahnung_id: 5, fehler: 'SMTP aus' }];
  const v = rechnungsVerlauf(re, mahnungen, versand, { karenzTage: 7 }, new Date('2026-11-08T12:00:00'));
  assert.deepEqual(v.map((e) => [e.datum, e.art, e.zustand]), [
    ['2026-10-03', 'erstellt', 'erledigt'], ['2026-10-03', 'versand', 'erledigt'], ['2026-10-17', 'frist', 'faellig'],
    ['2026-10-25', 'mahnung', 'erledigt'], ['2026-10-25', 'versand', 'fehler'], ['2026-11-04', 'frist', 'faellig'], ['2026-11-12', 'naechste', 'kommend'],
  ]);
  assert.equal(v.at(-1).titel, 'Mahnung möglich');
  const bez = rechnungsVerlauf({ ...re, status: 'bezahlt', bezahlt_am: '2026-10-10', mahnstufe: 0 }, [], [], {}, new Date('2026-11-08'));
  assert.deepEqual(bez.map((e) => [e.art, e.zustand]), [['erstellt', 'erledigt'], ['bezahlt', 'erledigt'], ['frist', 'erledigt']]);
});

test('Terminart: Betraege je Ergebnis, Abweichung von der ueblichen Dauer wird umgerechnet', async () => {
  const { terminBetrag } = await import('../../src/services/rechnungsLogik.js');
  const t = { beginn: '2026-11-03T14:00:00', ende: '2026-11-03T14:45:00', geplante_dauer_min: 60, preis_cent: 6000, ausfall_cent: 3000, unentschuldigt_cent: 4500 };
  const satz = { stattgefunden: 9999, ausgefallen: 9999, unentschuldigt: 9999 };
  assert.equal(terminBetrag({ ...t, status: 'stattgefunden' }, satz), 4500);
  assert.equal(terminBetrag({ ...t, status: 'ausgefallen' }, satz), 3000);
  assert.equal(terminBetrag({ ...t, status: 'unentschuldigt' }, satz), 4500);
  assert.equal(terminBetrag({ ...t, status: 'stattgefunden', preis_cent: null }, satz), 9999);
});
