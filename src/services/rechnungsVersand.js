// Versand von Rechnungen per E-Mail: einzeln mit bearbeitetem Entwurf, gesammelt aus dem Rechnungsausgang
// oder automatisch nach dem Monatslauf (Einstellung `einstellungen.autoversand`).
import { erstelleRechnungPdf, praxisAusEnv } from './rechnungPdf.js';
import { entwurfRechnung } from './mailDienst.js';

const MAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function erstelleRechnungsVersand(knex, mail, { werte = async () => process.env, log = console } = {}) {
  const praxisDaten = async () => praxisAusEnv(await werte());

  async function dokument(id) {
    const re = await knex('rechnungen').where({ id }).first();
    if (!re) return null;
    const pos = await knex('rechnungspositionen').where({ rechnung_id: re.id }).orderBy(['datum', 'id']);
    return { re, name: `Rechnung-${re.nummer}.pdf`, pdf: await erstelleRechnungPdf(re, pos, await praxisDaten()) };
  }

  // Adresse des Zahlers (aktuell, sonst die bei Erstellung gespeicherte), notfalls die des Klienten
  const empfaengerMail = async (re) => (re.zahler_id && (await knex('zahler').where({ id: re.zahler_id }).first('email'))?.email)
    || re.empfaenger_email || (await knex('klienten').where({ id: re.klient_id }).first('email'))?.email || '';

  async function entwurf(id) {
    const d = await dokument(id);
    if (!d) return null;
    return { an: await empfaengerMail(d.re), ...entwurfRechnung(d.re, (await praxisDaten()).name), eingerichtet: await mail.eingerichtet() };
  }

  /** Eine Rechnung senden; ohne `inhalt` mit dem Standardentwurf an die hinterlegte Adresse. */
  async function senden(id, inhalt = null) {
    const d = await dokument(id);
    if (!d) throw Object.assign(new Error('Rechnung nicht gefunden'), { status: 404, expose: true });
    if (d.re.status === 'storniert') throw Object.assign(new Error('Stornierte Rechnungen werden nicht versendet'), { status: 409, expose: true });
    const m = inhalt ?? { an: await empfaengerMail(d.re), ...entwurfRechnung(d.re, (await praxisDaten()).name) };
    if (!MAIL.test(m.an || '')) throw Object.assign(new Error(`Keine gültige E-Mail-Adresse für ${d.re.nummer} (Zahler ergänzen)`), { status: 400, expose: true });
    await mail.sende({ an: m.an, betreff: m.betreff, text: m.text, anhang: { name: d.name, daten: d.pdf }, rechnung_id: d.re.id });
    const [re] = await knex('rechnungen').where({ id: d.re.id }).update({ versendet_am: knex.fn.now() }).returning('*');
    return re;
  }

  /** Mehrere Rechnungen nacheinander senden; Fehler einzelner Rechnungen halten den Rest nicht auf. */
  async function sammelVersand(ids) {
    const gesendet = [], fehler = [];
    for (const id of ids) {
      try { gesendet.push(await senden(id)); } catch (e) {
        const nr = (await knex('rechnungen').where({ id }).first('nummer'))?.nummer ?? id;
        fehler.push({ id, nummer: nr, fehler: e.message });
      }
    }
    if (ids.length) log.info?.(`Rechnungsversand: ${gesendet.length} gesendet, ${fehler.length} fehlgeschlagen`);
    return { gesendet, fehler };
  }

  /** Nach dem Monatslauf: bei eingeschaltetem automatischem Versand die neuen Rechnungen senden. */
  async function nachLauf(erstellt) {
    const e = await knex('einstellungen').where({ id: 1 }).first('autoversand');
    if (!e?.autoversand || !erstellt.length) return null;
    return sammelVersand(erstellt.map((r) => r.id));
  }

  return { dokument, empfaengerMail, entwurf, senden, sammelVersand, nachLauf };
}
