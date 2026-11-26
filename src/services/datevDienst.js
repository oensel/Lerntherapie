import { buchungen, datevCsv, konten, alsAnsi } from './datevLogik.js';

// DATEV-Export eines Jahres: bezahlte Rechnungen nach Zahlungsdatum (Zufluss) und Eingangsrechnungen nach
// Zahlungsdatum bzw. – wie in der EÜR-Übersicht – ersatzweise Rechnungs-/Eingangsdatum (Abfluss).
export function erstelleDatevDienst(knex, { werte }) {
  const iso = (d) => (d instanceof Date ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : String(d).slice(0, 10));

  async function daten(jahr) {
    const rechnungen = await knex('rechnungen as r').leftJoin('umsaetze as u', 'u.id', 'r.umsatz_id')
      .where('r.status', 'bezahlt').whereRaw('extract(year from r.bezahlt_am) = ?', [jahr])
      .select('r.id', 'r.nummer', 'r.klient_name', 'r.leistungsmonat', 'r.bezahlt_am', 'r.betrag_cent', 'u.betrag_cent as gezahlt_cent');
    const pos = rechnungen.length ? await knex('rechnungspositionen as p').leftJoin('termine as t', 't.id', 'p.termin_id')
      .whereIn('p.rechnung_id', rechnungen.map((r) => r.id)).select('p.rechnung_id', 'p.betrag_cent', 't.status') : [];
    const einnahmen = rechnungen.map((r) => ({
      datum: iso(r.bezahlt_am), nummer: r.nummer, text: `${r.klient_name} ${r.leistungsmonat.slice(5)}/${r.leistungsmonat.slice(0, 4)}`,
      gezahlt_cent: r.gezahlt_cent > 0 ? r.gezahlt_cent : r.betrag_cent,
      positionen: pos.filter((p) => p.rechnung_id === r.id).map((p) => ({ betrag_cent: p.betrag_cent, art: ['ausgefallen', 'unentschuldigt'].includes(p.status) ? 'ausfall' : 'honorar' })),
    }));

    const datum = knex.raw('coalesce(e.bezahlt_am, e.rechnungsdatum, e.empfangen_am::date)');
    const belege = await knex('eingangsrechnungen as e').whereIn('e.status', ['eingang', 'bezahlt']).whereRaw('extract(year from ?) = ?', [datum, jahr])
      .select('e.id', 'e.lieferant', 'e.rechnungsnummer', 'e.beschreibung', 'e.brutto_cent', 'e.bezahlt_am', { datum });
    const posten = belege.length ? await knex('eingangsrechnung_posten').whereIn('rechnung_id', belege.map((b) => b.id)).orderBy(['rechnung_id', 'pos']) : [];
    const hinweise = [];
    const ausgaben = belege.map((b) => {
      let p = posten.filter((x) => x.rechnung_id === b.id);
      if (!p.length) {
        hinweise.push(`Beleg ${b.lieferant || b.id} ohne Posten – als „Sonstige Ausgaben“ gebucht`);
        p = [{ beschreibung: b.beschreibung || 'Beleg', betrag_cent: b.brutto_cent || 0, kategorie: 'Sonstige Ausgaben' }];
      }
      if (!b.bezahlt_am) hinweise.push(`Beleg ${b.lieferant || b.id} ohne Zahlungsdatum – nach Rechnungsdatum gebucht`);
      return { datum: iso(b.datum), beleg: b.rechnungsnummer || `ER-${b.id}`, lieferant: b.lieferant || 'Unbekannt', posten: p };
    });
    return { einnahmen, ausgaben, hinweise };
  }

  /** Vorschau (Summen, Hinweise) und Datei. */
  async function exportieren(jahr) {
    const w = await werte();
    const kt = konten(w);
    const { einnahmen, ausgaben, hinweise } = await daten(jahr);
    const bs = buchungen({ einnahmen, ausgaben }, kt);
    if (!w.DATEV_BERATER || !w.DATEV_MANDANT) hinweise.unshift('Berater- und Mandantennummer fehlen (Einstellungen → DATEV) – beim Steuerbüro erfragen');
    const csv = datevCsv({ jahr, buchungen: bs, berater: w.DATEV_BERATER, mandant: w.DATEV_MANDANT, skr: kt.skr });
    const summe = (xs, f) => xs.reduce((a, x) => a + f(x), 0);
    return {
      jahr, anzahl: bs.length, hinweise,
      einnahmen_cent: summe(einnahmen, (e) => e.gezahlt_cent),
      ausgaben_cent: summe(ausgaben, (a) => summe(a.posten, (p) => p.betrag_cent)),
      datei: alsAnsi(csv), dateiname: `EXTF_Buchungsstapel_${jahr}.csv`,
    };
  }

  return { exportieren };
}
