// DATEV-Export (Buchungsstapel im DATEV-Format, „EXTF“) für die EÜR eines Jahres – reine Logik ohne Datenbank.
// Zufluss-/Abflussprinzip (§ 11 EStG): gebucht wird nach Zahlungsdatum. Die Praxis ist umsatzsteuerfrei
// (§ 4 Nr. 21 UStG), daher keine BU-Schlüssel und Ausgaben brutto. Kontenvorschläge sind mit der Steuerberatung abzustimmen.
import { KATEGORIE_NAMEN } from './eingangLogik.js';

// Konten je Kontenrahmen: [Schlüssel, Bezeichnung, SKR03, SKR04]
export const KONTEN = [
  ['DATEV_BANK', 'Bankkonto', '1200', '1800'],
  ['DATEV_ERLOES', 'Erlöse Therapiestunden (steuerfrei)', '8100', '4100'],
  ['DATEV_ERLOES_AUSFALL', 'Ausfall- und Nichterscheinen-Honorare', '2700', '4830'],
  ['DATEV_ERLOES_SONST', 'Mahngebühren und Überzahlungen', '2700', '4830'],
];
// EÜR-Kategorie → Aufwandskonto (Reihenfolge wie KATEGORIEN); Anschaffungen über 800 € auf ein Anlagekonto
const KAT_KONTEN = [
  ['4210', '6310'], ['4980', '6850'], ['4940', '6820'], ['4945', '6821'], ['4930', '6815'], ['4910', '6800'],
  ['4920', '6805'], ['4806', '6495'], ['4855', '6260'], ['0490', '0690'], ['4360', '6400'], ['4600', '6600'],
  ['4670', '6673'], ['4650', '6640'], ['4970', '6855'], ['4950', '6825'], ['4900', '6300'],
];
export const katSchluessel = (i) => `DATEV_K${String(i + 1).padStart(2, '0')}`;
export const KAT_FELDER = KATEGORIE_NAMEN.map((n, i) => [katSchluessel(i), n]);

/** Vorgeschlagene Konten für SKR03 bzw. SKR04. */
export function vorgaben(skr = '03') {
  const s = skr === '04' ? 3 : 2;
  return {
    ...Object.fromEntries(KONTEN.map((k) => [k[0], k[s]])),
    ...Object.fromEntries(KAT_KONTEN.map((k, i) => [katSchluessel(i), k[s - 2]])),
  };
}

/** Wirksame Konten: Eingetragenes, sonst Vorschlag des Kontenrahmens. */
export function konten(werte) {
  const skr = werte.DATEV_KONTENRAHMEN === '04' ? '04' : '03';
  const v = vorgaben(skr);
  for (const k of Object.keys(v)) if (String(werte[k] ?? '').trim()) v[k] = String(werte[k]).trim();
  return { skr, ...v };
}

/**
 * Zahlungseingang einer Rechnung auf Erlöskonten aufteilen. Positionen tragen `art` ('honorar' | 'ausfall').
 * Überzahlung (z. B. Mahngebühr) → sonstige Erlöse; Unterzahlung kürzt zuerst Honorar, dann Ausfall.
 */
export function aufteilen(gezahltCent, positionen) {
  const t = { honorar: 0, ausfall: 0, sonst: 0 };
  for (const p of positionen) t[p.art === 'ausfall' ? 'ausfall' : 'honorar'] += p.betrag_cent;
  let rest = gezahltCent - t.honorar - t.ausfall;
  if (rest > 0) t.sonst = rest;
  else for (const k of ['honorar', 'ausfall']) { const ab = Math.min(t[k], -rest); t[k] -= ab; rest += ab; }
  return t;
}

/** Buchungen aus Einnahmen und Ausgaben. Beträge positiv in Cent, `soll`/`haben` sind Konten. */
export function buchungen({ einnahmen, ausgaben }, kt) {
  const b = [];
  for (const e of einnahmen) {
    const t = aufteilen(e.gezahlt_cent, e.positionen);
    for (const [art, konto, txt] of [['honorar', kt.DATEV_ERLOES, ''], ['ausfall', kt.DATEV_ERLOES_AUSFALL, ' Ausfall'], ['sonst', kt.DATEV_ERLOES_SONST, ' Mahngeb./Sonst.']]) {
      if (t[art] > 0) b.push({ datum: e.datum, betrag_cent: t[art], soll: kt.DATEV_BANK, haben: konto, beleg: e.nummer, text: `${e.text}${txt}` });
    }
  }
  for (const a of ausgaben) {
    for (const p of a.posten) {
      const i = Math.max(0, KATEGORIE_NAMEN.indexOf(p.kategorie));
      if (p.betrag_cent > 0) b.push({ datum: a.datum, betrag_cent: p.betrag_cent, soll: kt[katSchluessel(i)], haben: kt.DATEV_BANK, beleg: a.beleg, text: `${a.lieferant}: ${p.beschreibung}` });
      else if (p.betrag_cent < 0) b.push({ datum: a.datum, betrag_cent: -p.betrag_cent, soll: kt.DATEV_BANK, haben: kt[katSchluessel(i)], beleg: a.beleg, text: `${a.lieferant}: ${p.beschreibung}` });
    }
  }
  return b.sort((x, y) => x.datum.localeCompare(y.datum));
}

const q = (s, max) => `"${String(s ?? '').replace(/[\r\n;]+/g, ' ').replace(/"/g, '""').slice(0, max)}"`;
const betrag = (c) => (c / 100).toFixed(2).replace('.', ',');
const ttmm = (d) => d.slice(8, 10) + d.slice(5, 7);
const zeit = (d) => d.toISOString().replace(/\D/g, '').slice(0, 17);

/** CSV-Text im DATEV-Format (Kopfsatz, Spaltenüberschriften, Buchungen), CRLF. */
export function datevCsv({ jahr, buchungen: bs, berater, mandant, skr, bezeichnung = `EÜR ${jahr}`, jetzt = new Date() }) {
  const kopf = ['"EXTF"', 700, 21, '"Buchungsstapel"', 13, zeit(jetzt), '', '"RE"', '""', '""', berater || '', mandant || '',
    `${jahr}0101`, 4, `${jahr}0101`, `${jahr}1231`, q(bezeichnung, 30), '""', 1, 0, 0, '"EUR"', '', '""', '', '', `"${skr}"`, '', '', '""', '""'];
  const spalten = ['Umsatz (ohne Soll/Haben-Kz)', 'Soll/Haben-Kennzeichen', 'WKZ Umsatz', 'Kurs', 'Basis-Umsatz', 'WKZ Basis-Umsatz',
    'Konto', 'Gegenkonto (ohne BU-Schlüssel)', 'BU-Schlüssel', 'Belegdatum', 'Belegfeld 1', 'Belegfeld 2', 'Skonto', 'Buchungstext'];
  const zeilen = bs.map((b) => [betrag(b.betrag_cent), '"S"', '"EUR"', '', '', '""', b.soll, b.haben, '""', ttmm(b.datum), q(b.beleg, 36), '""', '', q(b.text, 60)].join(';'));
  return [kopf.join(';'), spalten.join(';'), ...zeilen].join('\r\n') + '\r\n';
}

/** Windows-1252/Latin-1 wie von DATEV erwartet; Zeichen außerhalb (z. B. €, Gedankenstrich) werden ersetzt. */
export function alsAnsi(text) {
  const ers = { '€': 'EUR', '–': '-', '—': '-', '„': '"', '“': '"', '”': '"', '‚': "'", '‘': "'", '’': "'", '…': '...' };
  return Buffer.from(text.replace(/[^\x00-\xff]/g, (z) => ers[z] ?? '?'), 'latin1');
}
