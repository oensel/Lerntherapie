// Beispiel-Finanzdaten für die Entwicklung: 12 Monate Termine, Rechnungen (bezahlt, offen, gemahnt, storniert),
// Kontoumsätze (Zahlungseingänge und Praxisausgaben) und Kontostand. Nur bei leerer Rechnungstabelle.
// Voraussetzung: Klienten mit Therapien und Zahlern (npm run demo:daten). Aufruf: npm run demo:finanzen
import { knex } from '../src/db.js';
import { erstelleRechnungsDienst } from '../src/services/rechnungsDienst.js';
import { naechsteNummer, empfaengerText, tagStr } from '../src/services/rechnungsLogik.js';

if (process.env.NODE_ENV === 'production') throw new Error('Nicht in Produktion ausführen');
const vorhanden = Number((await knex('rechnungen').count({ n: '*' }))[0].n);
if (vorhanden) { console.log(`Es gibt schon ${vorhanden} Rechnungen – nichts angelegt.`); await knex.destroy(); process.exit(0); }

// Weitere Beispiel-Klienten, damit die Praxis realistische Umsätze hat
const WEITERE = [
  ['Ben', 'Kaiser', 'Dyskalkulie', 'Julia Kaiser', 'Ahornweg 4\n48653 Coesfeld'],
  ['Emma', 'Wolf', 'LRS', 'Peter Wolf', 'Kirchplatz 2\n48712 Gescher'],
  ['Noah', 'Schulte', 'LRS', 'Katrin Schulte', 'Feldstr. 19\n48727 Billerbeck'],
  ['Hannah', 'Becker', 'Dyskalkulie', 'Kreis Borken, Jugendamt', 'Burloer Str. 93\n46325 Borken'],
  ['Paul', 'Richter', 'LRS', 'Sabine Richter', 'Mühlenweg 7\n48653 Coesfeld'],
];
for (const [vorname, nachname, schwerpunkt, zahlerName, adresse] of WEITERE) {
  if (await knex('klienten').where({ vorname, nachname }).first()) continue;
  const jugendamt = zahlerName.includes('Jugendamt');
  const [{ id }] = await knex('klienten').insert({ vorname, nachname, geburtsjahr: 2015, schwerpunkt, sorgeberechtigte: jugendamt ? null : zahlerName,
    kostentraeger: jugendamt ? 'jugendamt' : 'eltern', aufnahme_datum: '2025-08-01' }).returning('id');
  const [{ id: zid }] = await knex('zahler').insert({ klient_id: id, art: jugendamt ? 'jugendamt' : 'eltern', name: zahlerName, adresse,
    email: jugendamt ? null : `${zahlerName.split(' ')[0].toLowerCase()}.${nachname.toLowerCase()}@example.org` }).returning('id');
  await knex('therapien').insert({ klient_id: id, bezeichnung: `${schwerpunkt === 'LRS' ? 'LRS' : 'Dyskalkulie'}-Therapie`, zahler_id: zid });
}

const therapien = await knex('therapien').whereNotNull('zahler_id').where({ aktiv: true }).orderBy('id');
if (!therapien.length) { console.log('Keine Therapien mit Zahler – zuerst npm run demo:daten.'); await knex.destroy(); process.exit(0); }

// Fester Zufall, damit jeder Lauf gleich aussieht
let saat = 42;
const zufall = () => ((saat = (saat * 16807) % 2147483647) - 1) / 2147483646;
const plusTage = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const monatStr = (d) => tagStr(d).slice(0, 7);
const heute = new Date(); heute.setHours(0, 0, 0, 0);
const MONATE = 12;
const start = new Date(heute.getFullYear(), heute.getMonth() - MONATE, 1);
const monatsAnfang = new Date(heute.getFullYear(), heute.getMonth(), 1);

// 1. Wöchentliche Termine je Therapie in den vergangenen 12 Monaten (bis Ende Vormonat)
const INHALTE = ['Silbenschwingen, Lesetext', 'Zehnerübergang am Rechenrahmen', 'Wortarten markieren', 'Diktat mit Fehleranalyse', 'Einmaleins-Strategien', 'Leseflüssigkeit, Lautleseprotokoll', 'Sachaufgaben strukturieren'];
const termine = [];
therapien.forEach((th, i) => {
  for (let d = plusTage(start, i + 1); d < monatsAnfang; d = plusTage(d, 7)) {
    if (d.getDay() === 0 || d.getDay() === 6) continue;
    if (d.getMonth() === 7 && d.getDate() < 22) continue; // Sommerferien
    const z = zufall();
    const status = z < 0.82 ? 'stattgefunden' : z < 0.9 ? 'abgesagt' : z < 0.97 ? 'ausgefallen' : 'unentschuldigt';
    const beginn = new Date(d); beginn.setHours(14 + (i % 4), i % 2 ? 30 : 0);
    termine.push({ klient_id: th.klient_id, therapie_id: th.id, beginn, ende: new Date(+beginn + 60 * 60000), status,
      dokumentation: status === 'stattgefunden' ? INHALTE[Math.floor(zufall() * INHALTE.length)] : null });
  }
});
await knex('termine').insert(termine);

// 2. Rechnungen je Monat, datiert auf den 1. des Folgemonats (wie der automatische Lauf)
const dienst = erstelleRechnungsDienst(knex, { log: {} });
const rechnungen = [];
for (let m = new Date(start); m < monatsAnfang; m = new Date(m.getFullYear(), m.getMonth() + 1, 1)) {
  const monat = monatStr(m);
  const datum = new Date(m.getFullYear(), m.getMonth() + 1, 1);
  for (const v of (await dienst.vorschau(monat)).filter((x) => x.positionen.length && x.betrag_cent > 0 && x.zahler)) {
    const nummern = await knex('rechnungen').where('nummer', 'like', `${monatStr(datum)}-%`).pluck('nummer');
    const [r] = await knex('rechnungen').insert({
      nummer: naechsteNummer(nummern, datum), klient_id: v.klient_id, therapie_id: v.therapie_id, zahler_id: v.zahler.id,
      therapie_bezeichnung: v.therapie, empfaenger_email: v.zahler.email, leistungsmonat: monat,
      rechnungsdatum: tagStr(datum), faellig_am: tagStr(plusTage(datum, 14)), betrag_cent: v.betrag_cent,
      empfaenger: empfaengerText(v.zahler), klient_name: v.name, versendet_am: v.zahler.email ? plusTage(datum, 0) : null,
    }).returning('*');
    await knex('rechnungspositionen').insert(v.positionen.map((p) => ({ ...p, rechnung_id: r.id })));
    await knex('termine').whereIn('id', v.positionen.map((p) => p.termin_id)).update({ rechnung_id: r.id });
    rechnungen.push(r);
  }
}

// 3. Zahlungen und Status: ältere Rechnungen bezahlt, jüngste offen, einige gemahnt, eine storniert
const IBAN = 'DE02400501500000000001';
const umsaetze = [];
let fp = 0;
const umsatz = (datum, betrag_cent, gegen_name, verwendungszweck, buchungstext) => {
  umsaetze.push({ konto: IBAN, buchungsdatum: tagStr(datum), valuta: tagStr(datum), betrag_cent, gegen_name, verwendungszweck, buchungstext,
    gegen_iban: `DE${String(10 + (fp % 80)).padStart(2, '0')}400501500000${String(1000 + fp).padStart(6, '0')}`, fingerabdruck: `demo-${++fp}`,
    gesehen: datum < plusTage(heute, -3) });
  return umsaetze.at(-1);
};
const vormonat = monatStr(new Date(heute.getFullYear(), heute.getMonth() - 1, 1));
const nachAlter = [...rechnungen].sort((a, b) => a.rechnungsdatum.localeCompare?.(b.rechnungsdatum) ?? a.rechnungsdatum - b.rechnungsdatum);
const gemahnt = new Set();
// Zwei ältere Rechnungen bleiben offen: eine mit Zahlungserinnerung, eine mit Mahnung
const aelterOffen = nachAlter.filter((r) => r.leistungsmonat < vormonat).slice(-4, -2);
aelterOffen.forEach((r) => gemahnt.add(r.id));
const storno = nachAlter.find((r) => r.leistungsmonat < vormonat && !gemahnt.has(r.id) && r.betrag_cent > 0);

for (const r of nachAlter) {
  if (r.id === storno?.id) {
    await knex('rechnungen').where({ id: r.id }).update({ status: 'storniert' });
    await knex('termine').where({ rechnung_id: r.id }).update({ rechnung_id: null });
    continue;
  }
  if (gemahnt.has(r.id) || (r.leistungsmonat >= vormonat && r.id % 3 === 0)) continue; // bleibt offen
  const tag = plusTage(new Date(r.rechnungsdatum), 3 + Math.floor(zufall() * 12));
  if (tag > heute) continue;
  const zahlerName = r.empfaenger.split('\n')[0];
  // Meist mit Rechnungsnummer, manchmal nur Name und Betrag (Abgleich über Nachname)
  const zweck = zufall() < 0.75 ? `Rechnung ${r.nummer} ${r.klient_name}` : `Lerntherapie ${r.klient_name.split(' ')[0]} ${new Date(r.rechnungsdatum).toLocaleDateString('de-DE', { month: 'long' })}`;
  const u = umsatz(tag, r.betrag_cent, zahlerName.toUpperCase(), zweck, 'GUTSCHRIFT');
  r._umsatz = u;
}

// Mahnstufen für die beiden offenen älteren Rechnungen
for (const [i, r] of aelterOffen.entries()) {
  const stufe = i + 1;
  for (let s = 1; s <= stufe; s++) {
    const datum = plusTage(new Date(r.faellig_am), 8 + (s - 1) * 18);
    await knex('mahnungen').insert({ rechnung_id: r.id, stufe: s, datum: tagStr(datum), frist: tagStr(plusTage(datum, 10)), gebuehr_cent: s === 1 ? 0 : 500 });
  }
  await knex('rechnungen').where({ id: r.id }).update({ mahnstufe: stufe });
}

// 4. Praxisausgaben je Monat
const AUSGABEN = [
  [1, -42000, 'Immobilien Lindenhof GmbH', 'Miete Praxisraum', 'DAUERAUFTRAG'],
  [3, -3999, 'Telekom Deutschland GmbH', 'Festnetz/Internet Praxis', 'LASTSCHRIFT'],
  [5, -2850, 'HDI Versicherung AG', 'Berufshaftpflicht Beitrag', 'LASTSCHRIFT'],
  [15, -1290, 'All-Inkl.com', 'Webhosting und E-Mail', 'LASTSCHRIFT'],
];
for (let m = new Date(start); m <= heute; m = new Date(m.getFullYear(), m.getMonth() + 1, 1)) {
  for (const [tag, betrag, name, zweck, art] of AUSGABEN) {
    const d = new Date(m.getFullYear(), m.getMonth(), tag);
    if (d <= heute) umsatz(d, betrag, name, `${zweck} ${d.toLocaleDateString('de-DE', { month: '2-digit', year: 'numeric' })}`, art);
  }
  const d = new Date(m.getFullYear(), m.getMonth(), 8 + Math.floor(zufall() * 15));
  if (d <= heute) umsatz(d, -(1500 + Math.floor(zufall() * 9000)), zufall() < 0.5 ? 'Finken Verlag GmbH' : 'Thalia Buecher GmbH', 'Lernmaterial', 'KARTENZAHLUNG');
  if (m.getMonth() % 4 === 2) umsatz(new Date(m.getFullYear(), m.getMonth(), 20), -18900, 'Fachverband Lerntherapie e.V.', 'Fortbildung Rechenschwaeche', 'UEBERWEISUNG');
  if (m.getMonth() === 2) umsatz(new Date(m.getFullYear(), m.getMonth(), 10), -12000, 'Fachverband Lerntherapie e.V.', 'Mitgliedsbeitrag', 'LASTSCHRIFT');
}
// Privatentnahmen alle zwei Monate, damit der Kontostand realistisch bleibt
for (let m = new Date(start); m <= heute; m = new Date(m.getFullYear(), m.getMonth() + 2, 1)) {
  const d = new Date(m.getFullYear(), m.getMonth(), 25);
  if (d <= heute) umsatz(d, -60000, 'Praxisinhaberin', 'Privatentnahme', 'UEBERWEISUNG');
}

umsaetze.sort((a, b) => a.buchungsdatum.localeCompare(b.buchungsdatum));
const ids = await knex('umsaetze').insert(umsaetze).returning(['id', 'fingerabdruck']);
for (const r of nachAlter.filter((x) => x._umsatz)) {
  const id = ids.find((x) => x.fingerabdruck === r._umsatz.fingerabdruck).id;
  await knex('rechnungen').where({ id: r.id }).update({ status: 'bezahlt', bezahlt_am: r._umsatz.buchungsdatum, umsatz_id: id });
}

// 5. Kontostand: Anfangsbestand + alle Umsätze, Stand heute
const saldo = 1200000 + umsaetze.reduce((a, u) => a + u.betrag_cent, 0);
await knex('fints_zustand').where({ id: 1 }).update({ saldo_cent: saldo, saldo_datum: tagStr(heute), letzter_erfolg: knex.fn.now(), letzter_abruf: knex.fn.now(), letzter_fehler: null });

const st = await knex('rechnungen').select('status').count({ n: '*' }).groupBy('status');
console.log(`Angelegt: ${termine.length} Termine, ${rechnungen.length} Rechnungen (${st.map((s) => `${s.n} ${s.status}`).join(', ')}), ${umsaetze.length} Umsätze, Kontostand ${(saldo / 100).toFixed(2)} €`);
await knex.destroy();
