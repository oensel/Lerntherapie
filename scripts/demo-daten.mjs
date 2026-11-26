// Legt Beispiel-Klienten und Termine rund um die aktuelle Woche an (nur Entwicklung!): node scripts/demo-daten.mjs
import { knex } from '../src/db.js';

if (process.env.NODE_ENV === 'production') throw new Error('Nicht in Produktion ausführen');
const anzahl = Number((await knex('klienten').count({ n: '*' }))[0].n);
if (anzahl) { console.log(`Es gibt schon ${anzahl} Klienten – nichts angelegt.`); await knex.destroy(); process.exit(0); }

const mo = new Date(); mo.setHours(0, 0, 0, 0); mo.setDate(mo.getDate() - ((mo.getDay() + 6) % 7));
const um = (tag, h, m = 0) => { const d = new Date(mo); d.setDate(d.getDate() + tag); d.setHours(h, m); return d; };
const kl = await knex('klienten').insert([
  { vorname: 'Mia', nachname: 'Beispiel', geburtsjahr: 2016, schwerpunkt: 'LRS', sorgeberechtigte: 'Sandra Beispiel', telefon: '0171 0000001', kostentraeger: 'eltern', aufnahme_datum: '2026-03-02' },
  { vorname: 'Jonas', nachname: 'Muster', geburtsjahr: 2015, schwerpunkt: 'Dyskalkulie', sorgeberechtigte: 'Thomas Muster', telefon: '0160 0000002', kostentraeger: 'jugendamt', aufnahme_datum: '2025-09-15' },
  { vorname: 'Lea', nachname: 'Probe', geburtsjahr: 2017, schwerpunkt: 'LRS', sorgeberechtigte: 'Anna Probe', kostentraeger: 'eltern', material_noetig: true },
]).returning('id');
const [a, b, c] = kl.map((k) => k.id);
// Zahler und Therapien: Mia mit zwei Therapien (Eltern getrennt), Jonas über das Jugendamt
const [za, zb, zj, zc] = (await knex('zahler').insert([
  { klient_id: a, art: 'eltern', name: 'Sandra Beispiel', adresse: 'Lindenweg 3\n48653 Coesfeld', email: 'sandra.beispiel@example.org' },
  { klient_id: a, art: 'eltern', name: 'Martin Beispiel', adresse: 'Bahnhofstr. 12\n48653 Coesfeld', email: 'martin.beispiel@example.org' },
  { klient_id: b, art: 'jugendamt', name: 'Kreis Coesfeld, Jugendamt', adresse: 'Friedrich-Ebert-Str. 7\n48653 Coesfeld' },
  { klient_id: c, art: 'eltern', name: 'Anna Probe', adresse: 'Am Markt 1\n48653 Coesfeld', email: 'anna.probe@example.org' },
]).returning('id')).map((z) => z.id);
const [ta, , tb, tc] = (await knex('therapien').insert([
  { klient_id: a, bezeichnung: 'LRS-Therapie', zahler_id: za },
  { klient_id: a, bezeichnung: 'Dyskalkulie-Therapie', zahler_id: zb },
  { klient_id: b, bezeichnung: 'Dyskalkulie-Therapie', zahler_id: zj, stundensatz_cent: 6200 },
  { klient_id: c, bezeichnung: 'LRS-Therapie', zahler_id: zc },
]).returning('id')).map((x) => x.id);
const therapieVon = { [a]: ta, [b]: tb, [c]: tc };
const t = (k, d, status = 'geplant', dokumentation = null, min = 60) => ({ klient_id: k, therapie_id: therapieVon[k], beginn: d, ende: new Date(+d + min * 60000), status, dokumentation });
await knex('termine').insert([
  t(a, um(-7, 14), 'stattgefunden', 'Silbenschwingen, Lesetext S. 1–3'), t(b, um(-5, 15, 30), 'stattgefunden', 'Zehnerübergang mit Rechenrahmen'),
  t(a, um(0, 14), 'stattgefunden', 'Wortarten markieren'), t(b, um(1, 15, 30), 'ausgefallen'), t(a, um(2, 16)), t(b, um(3, 14)),
  t(a, um(7, 14)), t(b, um(8, 15, 30)), t(c, um(9, 14, 0)),
]);
console.log('Beispieldaten angelegt.');
await knex.destroy();
