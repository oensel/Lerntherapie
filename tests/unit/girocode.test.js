import { test } from 'node:test';
import assert from 'node:assert/strict';
import { epcPayload, ibanGueltig } from '../../src/services/girocode.js';
import { erstelleRechnungPdf } from '../../src/services/rechnungPdf.js';

const IBAN = 'DE89 3704 0044 0532 0130 00';

test('IBAN-Prüfziffer', () => {
  assert.equal(ibanGueltig(IBAN), true);
  assert.equal(ibanGueltig('DE89370400440532013001'), false);
  assert.equal(ibanGueltig(''), false);
});

test('EPC-Inhalt nach EPC069-12', () => {
  const p = epcPayload({ name: 'Lernpraxis\nMuster', iban: IBAN, bic: 'COBADEFFXXX', betragCent: 24050, zweck: '2026-10-001' }).split('\n');
  assert.deepEqual(p, ['BCD', '002', '1', 'SCT', 'COBADEFFXXX', 'Lernpraxis Muster', 'DE89370400440532013000', 'EUR240.50', '', '', '2026-10-001']);
});

test('ohne gültige IBAN oder Betrag kein QR-Code', () => {
  assert.equal(epcPayload({ name: 'X', iban: 'DE00', betragCent: 100, zweck: 'x' }), null);
  assert.equal(epcPayload({ name: 'X', iban: IBAN, betragCent: 0, zweck: 'x' }), null);
});

test('Rechnungs-PDF entsteht mit und ohne IBAN', async () => {
  const r = { nummer: '2026-10-001', rechnungsdatum: '2026-11-01', faellig_am: '2026-11-15', empfaenger: 'Familie Muster\nWeg 1\n12345 Ort', klient_name: 'Mia Muster', leistungsmonat: '2026-10', betrag_cent: 12000 };
  const pos = [{ datum: '2026-10-05', beschreibung: 'Therapiestunde', betrag_cent: 12000 }];
  const praxis = { name: 'Lernpraxis', anschrift: ['Weg 2', '12345 Ort'], iban: IBAN, bic: '', bank: '', steuernr: '', hinweis: '', logo: '' };
  const mit = await erstelleRechnungPdf(r, pos, praxis);
  const ohne = await erstelleRechnungPdf(r, pos, { ...praxis, iban: '' });
  assert.ok(mit.length > ohne.length + 1000, 'QR-Code macht das PDF größer');
});
