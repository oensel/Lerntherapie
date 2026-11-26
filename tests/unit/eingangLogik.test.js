import { test } from 'node:test';
import assert from 'node:assert/strict';
import { istBeleg, kopfAusKi, postenAusKi, schema, schemaPruefen, SONSTIGE } from '../../src/services/eingangLogik.js';

const ki = (x = {}) => ({ lieferant: 'Lernverlag', rechnungsnummer: 'R-1', rechnungsdatum: '2026-11-02', faellig_am: null, brutto_cent: 5950, ust_cent: 950, beschreibung: 'Lernmaterial', kategorie: 'Therapie- und Lernmaterial', positionen: [], ...x });

test('Posten passen zum Bruttobetrag: werden übernommen', () => {
  const p = postenAusKi(ki({ positionen: [
    { beschreibung: 'Lernspiel', betrag_cent: 3570, kategorie: 'Therapie- und Lernmaterial' },
    { beschreibung: 'Fachbuch', betrag_cent: 1785, kategorie: 'Fachliteratur' },
    { beschreibung: 'Versand', betrag_cent: 594, kategorie: 'Porto' },
  ] }), 5950);
  assert.deepEqual(p.map((x) => [x.kategorie, x.betrag_cent]), [['Therapie- und Lernmaterial', 3571], ['Fachliteratur', 1785], ['Porto', 594]]);
});

test('Summe passt nicht: ein Posten mit Hauptkategorie', () => {
  const p = postenAusKi(ki({ positionen: [{ beschreibung: 'a', betrag_cent: 1000, kategorie: 'Porto' }, { beschreibung: 'b', betrag_cent: 1000, kategorie: 'Porto' }] }), 5950);
  assert.deepEqual(p, [{ beschreibung: 'Lernmaterial', betrag_cent: 5950, kategorie: 'Therapie- und Lernmaterial' }]);
});

test('unbekannte Kategorie wird zu Sonstige Ausgaben', () => {
  assert.equal(postenAusKi(ki({ kategorie: 'Erfunden' }), 100)[0].kategorie, SONSTIGE);
  assert.deepEqual(postenAusKi(ki(), null), []);
});

test('Schema prüft Kategorien und Pflichtfelder', () => {
  assert.deepEqual(schemaPruefen(ki(), schema()), []);
  assert.ok(schemaPruefen(ki({ kategorie: 'Erfunden' }), schema()).length);
  const { positionen, ...ohne } = ki();
  assert.ok(schemaPruefen(ohne, schema()).length);
});

test('Kopfdaten: ungültige Werte werden verworfen', () => {
  assert.deepEqual(kopfAusKi(ki({ rechnungsdatum: '02.11.2026', brutto_cent: -5 })), { lieferant: 'Lernverlag', rechnungsnummer: 'R-1', rechnungsdatum: null, faellig_am: null, brutto_cent: null, ust_cent: 950, beschreibung: 'Lernmaterial' });
});

test('Belege: PDF und Bilder', () => {
  assert.ok(istBeleg({ contentType: 'application/pdf' }));
  assert.ok(istBeleg({ contentType: 'application/octet-stream', filename: 'Rechnung.PDF' }));
  assert.ok(!istBeleg({ contentType: 'text/html', filename: 'agb.html' }));
});
