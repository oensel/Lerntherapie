import { createHash } from 'node:crypto';

// Datum als YYYY-MM-DD in lokaler Zeit (lib-fints liefert Date-Objekte um Mitternacht lokal)
export function alsDatum(d) {
  if (!d) return null;
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
}

// Bildet die Buchungen eines Abrufs auf Tabellenzeilen ab. Gleiche Buchungen innerhalb eines Abrufs (z.B. zweimal derselbe
// Betrag vom selben Absender am selben Tag) bekommen eine laufende Nummer in den Fingerabdruck, damit sie nicht zusammenfallen;
// überlappende Abrufe liefern dieselbe Reihenfolge und damit dieselben Fingerabdrücke.
export function bildeUmsaetze(konto, buchungen) {
  const zaehler = new Map();
  return buchungen.map((b) => {
    const zeile = {
      konto,
      buchungsdatum: alsDatum(b.entryDate ?? b.valueDate),
      valuta: alsDatum(b.valueDate),
      betrag_cent: Math.round(Number(b.amount) * 100),
      waehrung: 'EUR',
      gegen_name: b.remoteName?.trim() || null,
      gegen_iban: b.remoteAccountNumber?.trim() || null,
      gegen_bic: b.remoteBankId?.trim() || null,
      verwendungszweck: b.purpose?.trim() || null,
      buchungstext: b.bookingText?.trim() || null,
      end_to_end_referenz: b.e2eReference?.trim() || null,
      mandatsreferenz: b.mandateReference?.trim() || null,
    };
    const basis = [konto, zeile.buchungsdatum, zeile.valuta, zeile.betrag_cent, zeile.gegen_iban, zeile.gegen_name,
      zeile.verwendungszweck, zeile.end_to_end_referenz, b.bankReference ?? ''].join('|');
    const n = (zaehler.get(basis) ?? 0) + 1;
    zaehler.set(basis, n);
    zeile.fingerabdruck = createHash('sha256').update(`${basis}|${n}`).digest('hex');
    return zeile;
  });
}
