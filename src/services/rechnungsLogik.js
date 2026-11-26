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

export function positionsText(termin, bezeichnung = 'Lerntherapie') {
  const min = Math.round((new Date(termin.ende) - new Date(termin.beginn)) / 60000);
  const zusatz = termin.status === 'ausgefallen' ? ' (Ausfall, < 24 h abgesagt)' : termin.status === 'unentschuldigt' ? ' (nicht erschienen)' : '';
  return `${bezeichnung} ${min} min${zusatz}`;
}

// Geltende Sätze einer Therapie: eigener Wert, sonst der allgemeine Standard (NULL = Standard)
export function saetze(therapie, standard) {
  const w = (feld) => therapie?.[feld] ?? standard[feld];
  return { stattgefunden: w('stundensatz_cent'), ausgefallen: w('ausfall_cent'), unentschuldigt: w('unentschuldigt_cent') };
}

// Positionen eines Klienten: je berechnetem Termin der Betrag für seinen Status; Beträge von 0 € entfallen
export function positionen(termine, satzJeStatus, bezeichnung) {
  return termine
    .filter((t) => BERECHNET.includes(t.status) && !t.rechnung_id && satzJeStatus[t.status] > 0)
    .sort((a, b) => new Date(a.beginn) - new Date(b.beginn))
    .map((t) => ({ termin_id: t.id, datum: tagStr(new Date(t.beginn)), beschreibung: positionsText(t, bezeichnung), betrag_cent: satzJeStatus[t.status] }));
}

// Nächste Nummer im Format JJJJ-MM-NNN aus den bereits vergebenen Nummern desselben Präfixes
export function naechsteNummer(vorhandene, datum = new Date()) {
  const praefix = `${datum.getFullYear()}-${pad(datum.getMonth() + 1)}-`;
  const max = vorhandene.filter((n) => n.startsWith(praefix)).map((n) => Number(n.slice(praefix.length)) || 0).reduce((a, b) => Math.max(a, b), 0);
  return praefix + String(max + 1).padStart(3, '0');
}

// Anschriftenfeld aus dem Zahler (Name + mehrzeilige Adresse)
export function empfaengerText(zahler) {
  return [zahler.name, zahler.adresse].filter(Boolean).join('\n');
}

// Zahlungsabgleich: Umsatz passt, wenn er ein Eingang ist, die Rechnungsnummer im Verwendungszweck steht
// und der Betrag mindestens dem Rechnungsbetrag entspricht.
export function passendeRechnung(umsatz, offene) {
  if (umsatz.betrag_cent <= 0) return null;
  const zweck = (umsatz.verwendungszweck || '').replace(/\s+/g, '');
  return offene.find((r) => zweck.includes(r.nummer) && umsatz.betrag_cent >= r.betrag_cent) ?? null;
}

export const ueberfaellig = (r, heute = tagStr(new Date())) => r.status === 'offen' && tagStr(new Date(r.faellig_am)) < heute;

// ---------- Mahnwesen ----------
export const MAHNSTUFEN = { 1: 'Zahlungserinnerung', 2: 'Mahnung', 3: 'Letzte Mahnung' };

export function mahnEinstellungen(env = process.env) {
  const zahl = (v, std) => (v === undefined || v === '' || Number.isNaN(Number(v)) ? std : Number(v));
  return {
    karenzTage: zahl(env.MAHN_KARENZ_TAGE, 7), // nach Fälligkeit bzw. nach Ablauf der letzten Mahnfrist
    fristTage: zahl(env.MAHN_FRIST_TAGE, 10), // neue Zahlungsfrist je Mahnung
    gebuehren: [0, zahl(env.MAHN_GEBUEHR_2_CENT, 0), zahl(env.MAHN_GEBUEHR_3_CENT, 0)], // Stufe 1 immer kostenfrei
  };
}

const plusTage = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

// Nächste fällige Mahnstufe oder null: offen, Frist (Fälligkeit bzw. letzte Mahnfrist) + Karenz verstrichen, Stufe < 3
export function naechsteMahnstufe(r, letzteMahnung, { karenzTage }, heute = new Date()) {
  if (r.status !== 'offen' || r.mahnstufe >= 3) return null;
  const frist = letzteMahnung ? letzteMahnung.frist : r.faellig_am;
  return tagStr(plusTage(new Date(frist), karenzTage)) < tagStr(heute) ? r.mahnstufe + 1 : null;
}

export function neueMahnung(r, stufe, { fristTage, gebuehren }, heute = new Date()) {
  return { rechnung_id: r.id, stufe, datum: tagStr(heute), frist: tagStr(plusTage(heute, fristTage)), gebuehr_cent: gebuehren[stufe - 1] ?? 0 };
}
