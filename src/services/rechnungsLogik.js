// Reine Abrechnungslogik ohne Datenbank (unit-getestet).

export const BERECHNET = ['stattgefunden', 'ausgefallen', 'unentschuldigt'];
const pad = (n) => String(n).padStart(2, '0');
export const tagStr = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// 'YYYY-MM' → [Beginn, Beginn Folgemonat] in lokaler Zeit (Server läuft mit TZ=Europe/Berlin)
export function monatsGrenzen(monat) {
  const [j, m] = monat.split('-').map(Number);
  return [new Date(j, m - 1, 1), new Date(j, m, 1)];
}

export const vormonat = (jetzt = new Date()) => {
  const d = new Date(jetzt.getFullYear(), jetzt.getMonth() - 1, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
};

export function positionsText(termin) {
  const min = Math.round((new Date(termin.ende) - new Date(termin.beginn)) / 60000);
  const zusatz = termin.status === 'ausgefallen' ? ' (Ausfall, < 24 h abgesagt)' : termin.status === 'unentschuldigt' ? ' (nicht erschienen)' : '';
  return `Lerntherapie ${min} min${zusatz}`;
}

// Positionen eines Klienten: jeder berechnete Termin = eine Einheit zum Stundensatz
export function positionen(termine, satzCent) {
  return termine
    .filter((t) => BERECHNET.includes(t.status) && !t.rechnung_id)
    .sort((a, b) => new Date(a.beginn) - new Date(b.beginn))
    .map((t) => ({ termin_id: t.id, datum: tagStr(new Date(t.beginn)), beschreibung: positionsText(t), betrag_cent: satzCent }));
}

// Nächste Nummer im Format JJJJ-MM-NNN aus den bereits vergebenen Nummern desselben Präfixes
export function naechsteNummer(vorhandene, datum = new Date()) {
  const praefix = `${datum.getFullYear()}-${pad(datum.getMonth() + 1)}-`;
  const max = vorhandene.filter((n) => n.startsWith(praefix)).map((n) => Number(n.slice(praefix.length)) || 0).reduce((a, b) => Math.max(a, b), 0);
  return praefix + String(max + 1).padStart(3, '0');
}

export function empfaengerText(k) {
  const name = k.sorgeberechtigte || `${k.vorname} ${k.nachname}`;
  return [k.kostentraeger === 'jugendamt' ? 'Jugendamt' : null, name, k.adresse].filter(Boolean).join('\n');
}

// Zahlungsabgleich: Umsatz passt, wenn er ein Eingang ist, die Rechnungsnummer im Verwendungszweck steht
// und der Betrag mindestens dem Rechnungsbetrag entspricht.
export function passendeRechnung(umsatz, offene) {
  if (umsatz.betrag_cent <= 0) return null;
  const zweck = (umsatz.verwendungszweck || '').replace(/\s+/g, '');
  return offene.find((r) => zweck.includes(r.nummer) && umsatz.betrag_cent >= r.betrag_cent) ?? null;
}

export const ueberfaellig = (r, heute = tagStr(new Date())) => r.status === 'offen' && tagStr(new Date(r.faellig_am)) < heute;
