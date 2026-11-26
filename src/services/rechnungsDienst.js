import { mahnEinstellungen, naechsteMahnstufe, neueMahnung, BERECHNET, monatsGrenzen, positionen, naechsteNummer, empfaengerText, passendeRechnung, vormonat, tagStr } from './rechnungsLogik.js';
import { starteTagesplan } from './zeitplan.js';

const ZAHLUNGSZIEL_TAGE = 14;

export function erstelleRechnungsDienst(knex, { env = process.env, log = console } = {}) {
  // Je aktivem Klient die noch nicht abgerechneten, berechenbaren Termine des Monats; dazu vergangene Termine ohne Status
  async function vorschau(monat) {
    const [von, bis] = monatsGrenzen(monat);
    const termine = await knex('termine').where('beginn', '>=', von).where('beginn', '<', bis).whereNotNull('klient_id');
    const klienten = await knex('klienten').whereIn('id', [...new Set(termine.map((t) => t.klient_id))]);
    const vorhandene = await knex('rechnungen').where({ leistungsmonat: monat }).whereNot({ status: 'storniert' }).pluck('klient_id');
    const jetzt = new Date();
    return klienten.map((k) => {
      const eigene = termine.filter((t) => t.klient_id === k.id);
      const pos = positionen(eigene, k.stundensatz_cent ?? 0);
      return {
        klient_id: k.id, name: `${k.vorname} ${k.nachname}`, klient: k, positionen: pos,
        betrag_cent: pos.reduce((a, p) => a + p.betrag_cent, 0),
        ohne_status: eigene.filter((t) => t.status === 'geplant' && new Date(t.beginn) < jetzt).length,
        noch_geplant: eigene.filter((t) => t.status === 'geplant' && new Date(t.beginn) >= jetzt).length,
        bereits_berechnet: vorhandene.includes(k.id),
      };
    }).filter((v) => v.positionen.length || v.ohne_status).sort((a, b) => a.name.localeCompare(b.name));
  }

  // Erstellt je Klient eine Rechnung; Klienten mit bestehender Rechnung im Monat werden übersprungen
  async function lauf(monat, { klientIds } = {}) {
    const liste = (await vorschau(monat)).filter((v) => v.positionen.length && !v.bereits_berechnet && v.betrag_cent > 0
      && (!klientIds || klientIds.includes(v.klient_id)));
    const erstellt = [];
    for (const v of liste) {
      const r = await knex.transaction(async (trx) => {
        await trx.raw('lock table rechnungen in share row exclusive mode'); // Nummern lückenlos und eindeutig
        const heute = new Date();
        const nummern = await trx('rechnungen').where('nummer', 'like', `${tagStr(heute).slice(0, 7)}-%`).pluck('nummer');
        const faellig = new Date(heute); faellig.setDate(faellig.getDate() + ZAHLUNGSZIEL_TAGE);
        const [neu] = await trx('rechnungen').insert({
          nummer: naechsteNummer(nummern, heute), klient_id: v.klient_id, leistungsmonat: monat,
          rechnungsdatum: tagStr(heute), faellig_am: tagStr(faellig), betrag_cent: v.betrag_cent,
          empfaenger: empfaengerText(v.klient), klient_name: v.name,
        }).returning('*');
        await trx('rechnungspositionen').insert(v.positionen.map((p) => ({ ...p, rechnung_id: neu.id })));
        await trx('termine').whereIn('id', v.positionen.map((p) => p.termin_id)).update({ rechnung_id: neu.id });
        return neu;
      });
      erstellt.push(r);
    }
    log.info?.(`Rechnungslauf ${monat}: ${erstellt.length} Rechnung(en) erstellt`);
    return erstellt;
  }

  // Storno gibt die Termine wieder frei, damit sie neu abgerechnet werden können
  async function stornieren(id) {
    return knex.transaction(async (trx) => {
      const [r] = await trx('rechnungen').where({ id, status: 'offen' }).update({ status: 'storniert' }).returning('*');
      if (r) await trx('termine').where({ rechnung_id: id }).update({ rechnung_id: null });
      return r;
    });
  }

  // Offene Rechnungen mit eingegangenen, noch nicht zugeordneten Umsätzen abgleichen
  async function abgleichen() {
    const offene = await knex('rechnungen').where({ status: 'offen' });
    if (!offene.length) return [];
    const umsaetze = await knex('umsaetze').where('betrag_cent', '>', 0)
      .whereNotIn('id', knex('rechnungen').whereNotNull('umsatz_id').select('umsatz_id')).orderBy('buchungsdatum');
    const treffer = [];
    for (const u of umsaetze) {
      const r = passendeRechnung(u, offene.filter((o) => !treffer.some((t) => t.id === o.id)));
      if (!r) continue;
      await knex('rechnungen').where({ id: r.id }).update({ status: 'bezahlt', bezahlt_am: u.buchungsdatum, umsatz_id: u.id });
      treffer.push(r);
    }
    if (treffer.length) log.info?.(`Zahlungsabgleich: ${treffer.length} Rechnung(en) als bezahlt markiert`);
    return treffer;
  }

  // Offene Rechnungen, für die jetzt die nächste Mahnstufe fällig ist
  async function faelligeMahnungen(heute = new Date()) {
    const e = mahnEinstellungen(env);
    const offene = await knex('rechnungen').where({ status: 'offen' }).where('mahnstufe', '<', 3).orderBy('faellig_am');
    const mahnungen = await knex('mahnungen').whereIn('rechnung_id', offene.map((r) => r.id)).orderBy('stufe');
    return offene.map((r) => {
      const letzte = mahnungen.filter((m) => m.rechnung_id === r.id).at(-1);
      return { rechnung: r, stufe: naechsteMahnstufe(r, letzte, e, heute) };
    }).filter((x) => x.stufe);
  }

  // Legt die nächste Mahnstufe an (nur wenn fällig, außer `erzwingen`)
  async function mahnen(rechnungId, { erzwingen = false, heute = new Date() } = {}) {
    const e = mahnEinstellungen(env);
    return knex.transaction(async (trx) => {
      const r = await trx('rechnungen').where({ id: rechnungId }).forUpdate().first();
      if (!r || r.status !== 'offen' || r.mahnstufe >= 3) return null;
      const letzte = await trx('mahnungen').where({ rechnung_id: r.id }).orderBy('stufe', 'desc').first();
      const stufe = naechsteMahnstufe(r, letzte, e, heute) ?? (erzwingen ? r.mahnstufe + 1 : null);
      if (!stufe) return null;
      const [m] = await trx('mahnungen').insert(neueMahnung(r, stufe, e, heute)).returning('*');
      await trx('rechnungen').where({ id: r.id }).update({ mahnstufe: stufe });
      return m;
    });
  }

  // Täglich 06:00; am 1. des Monats Rechnungen für den Vormonat. Abgleich nach jedem FinTS-Abruf.
  function starteZeitplan() {
    return starteTagesplan('Rechnungslauf', [env.RECHNUNG_LAUFZEIT || '06:00'], async () => {
      if (new Date().getDate() !== 1) return;
      try { await lauf(vormonat()); } catch (e) { log.error?.('Rechnungslauf fehlgeschlagen:', e); }
    }, log);
  }

  return { vorschau, lauf, stornieren, abgleichen, faelligeMahnungen, mahnen, starteZeitplan };
}

export { BERECHNET };
