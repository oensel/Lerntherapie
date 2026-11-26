// Reine Abrechnungslogik ohne Datenbank (unit-getestet).

export const BERECHNET = ['stattgefunden', 'ausgefallen', 'unentschuldigt'];
const pad = (n) => String(n).padStart(2, '0');
export const tagStr = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// 'YYYY-MM' → [Beginn, Beginn Folgemonat] in lokaler Zeit (Server läuft mit TZ=Europe/Berlin)
export function monatsGrenzen(monat) {
  const [j, m] = monat.split('-').map(Number);
  return [new Date(j, m - 1, 1), new Date(j, m, 1)];
}

// Tag im Monat, an dem der Lauf für den Vormonat startet
export const LAUFTAG = 3;

export const vormonat = (jetzt = new Date()) => {
  const d = new Date(jetzt.getFullYear(), jetzt.getMonth() - 1, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
};

export function positionsText(termin, bezeichnung = 'Lerntherapie') {
  const min = Math.round((new Date(termin.ende) - new Date(termin.beginn)) / 60000);
  const zusatz = termin.status === 'ausgefallen' ? ' (Ausfall, < 24 h abgesagt)' : termin.status === 'unentschuldigt' ? ' (nicht erschienen)' : '';
  return `${termin.terminart_name || bezeichnung} ${min} min${zusatz}`;
}

// Betrag eines Termins mit Terminart: Preis anteilig nach realer Dauer (ende - beginn) im Verhältnis zur geplanten Dauer
export function artBetrag(termin) {
  if (termin.preis_cent == null || !(termin.geplante_dauer_min > 0)) return null;
  const min = Math.round((new Date(termin.ende) - new Date(termin.beginn)) / 60000);
  return Math.round((termin.preis_cent * min) / termin.geplante_dauer_min);
}

// Betrag je Termin mit Terminart: stattgefunden → Preis auf die reale Dauer umgerechnet (der Preis gilt für die übliche Dauer);
// ausgefallen / unentschuldigt → fester Betrag der Terminart. Termine ohne Art (Altbestand): Sätze der Therapie bzw. Standard.
export function terminBetrag(t, satzJeStatus) {
  if (t.preis_cent == null) return satzJeStatus[t.status];
  if (t.status === 'stattgefunden') return artBetrag(t);
  if (t.status === 'ausgefallen') return t.ausfall_cent ?? satzJeStatus.ausgefallen;
  if (t.status === 'unentschuldigt') return t.unentschuldigt_cent ?? satzJeStatus.unentschuldigt;
  return 0;
}

// Geltende Sätze einer Therapie: eigener Wert, sonst der allgemeine Standard (NULL = Standard)
export function saetze(therapie, standard) {
  const w = (feld) => therapie?.[feld] ?? standard[feld];
  return { stattgefunden: w('stundensatz_cent'), ausgefallen: w('ausfall_cent'), unentschuldigt: w('unentschuldigt_cent') };
}

// Positionen eines Klienten: je berechnetem Termin der Betrag für seinen Status; Beträge von 0 € entfallen
export function positionen(termine, satzJeStatus, bezeichnung) {
  return termine
    .filter((t) => BERECHNET.includes(t.status) && !t.rechnung_id && terminBetrag(t, satzJeStatus) > 0)
    .sort((a, b) => new Date(a.beginn) - new Date(b.beginn))
    .map((t) => ({ termin_id: t.id, datum: tagStr(new Date(t.beginn)), beschreibung: positionsText(t, bezeichnung), betrag_cent: terminBetrag(t, satzJeStatus) }));
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

// Für Namensvergleiche: klein, Umlaute ausgeschrieben, nur Buchstaben/Ziffern als Wörter
const norm = (t) => String(t ?? '').toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ');
const nachname = (name) => norm(name).trim().split(' ').at(-1) || '';

// Nachnamen einer Rechnung: Klient und Zahler (erste Zeile des Empfängers)
export const nachnamenVon = (r) => [...new Set([nachname(r.klient_name), nachname(String(r.empfaenger ?? '').split('\n')[0])])].filter((n) => n.length >= 2);

// Zahlungsabgleich für einen Eingang:
// 1. Rechnungsnummer im Verwendungszweck und Betrag mindestens der Rechnungsbetrag.
// 2. Sonst: Betrag genau gleich und ein Nachname (Klient oder Zahler) im Verwendungszweck oder Namen des Zahlenden –
//    nur wenn das genau eine offene Rechnung trifft.
export function passendeRechnung(umsatz, offene) {
  if (umsatz.betrag_cent <= 0) return null;
  const zweck = (umsatz.verwendungszweck || '').replace(/\s+/g, '');
  const perNummer = offene.find((r) => zweck.includes(r.nummer) && umsatz.betrag_cent >= r.betrag_cent);
  if (perNummer) return perNummer;
  const woerter = new Set(norm(`${umsatz.verwendungszweck ?? ''} ${umsatz.gegen_name ?? ''}`).split(' '));
  const kandidaten = offene.filter((r) => r.betrag_cent === umsatz.betrag_cent && nachnamenVon(r).some((n) => woerter.has(n)));
  return kandidaten.length === 1 ? kandidaten[0] : null;
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

// ---------- Verlauf einer Rechnung ----------
// Ereignisse in zeitlicher Reihenfolge: Erstellung, Versand (auch Fehlversuche), Zahlungsfrist, Mahnungen mit Fristen,
// Zahlung bzw. Storno; bei offenen Rechnungen zusätzlich der nächste Schritt (ab wann die nächste Mahnstufe möglich ist).
// zustand: erledigt | fehler | offen (Frist läuft) | faellig (überschritten, Handlung möglich) | kommend
export function rechnungsVerlauf(re, mahnungen = [], versand = [], { karenzTage = 7 } = {}, heute = new Date()) {
  const h = tagStr(heute), tag = (d) => tagStr(new Date(d));
  const ev = [];
  const add = (datum, art, titel, text, zustand = 'erledigt', extra = {}) => ev.push({ datum: tag(datum), zeit: new Date(datum).getTime(), art, titel, text, zustand, ...extra });
  add(`${tag(re.rechnungsdatum)}T00:00:00`, 'erstellt', 'Rechnung erstellt', `Rechnungsdatum ${tag(re.rechnungsdatum).split('-').reverse().join('.')}, Zahlungsziel ${tag(re.faellig_am).split('-').reverse().join('.')}`);
  for (const v of [...versand].sort((a, b) => new Date(a.gesendet_am) - new Date(b.gesendet_am))) {
    const zu = v.mahnung_id ? mahnungen.find((m) => m.id === v.mahnung_id) : null;
    const was = zu ? MAHNSTUFEN[zu.stufe] : 'Rechnung';
    add(v.gesendet_am, 'versand', v.fehler ? `Versand fehlgeschlagen (${was})` : `${was} per E-Mail versendet`, v.fehler ? `an ${v.an}: ${v.fehler}` : `an ${v.an}`, v.fehler ? 'fehler' : 'erledigt');
  }
  const bezahlt = re.status === 'bezahlt' && re.bezahlt_am ? tag(re.bezahlt_am) : null;
  const ende = bezahlt || (re.status === 'storniert' && re.storniert_am ? tag(re.storniert_am) : null);
  const fristZustand = (frist) => (ende ? (ende <= tag(frist) ? 'erledigt' : 'faellig') : tag(frist) < h ? 'faellig' : 'offen');
  add(`${tag(re.faellig_am)}T23:59:00`, 'frist', 'Zahlungsfrist', fristZustand(re.faellig_am) === 'faellig' && !ende ? 'verstrichen – keine Zahlung eingegangen' : fristZustand(re.faellig_am) === 'offen' ? 'läuft noch' : bezahlt && bezahlt > tag(re.faellig_am) ? 'verstrichen' : 'eingehalten', re.status === 'storniert' ? 'erledigt' : fristZustand(re.faellig_am));
  for (const m of [...mahnungen].sort((a, b) => a.stufe - b.stufe)) {
    add(`${tag(m.datum)}T00:00:01`, 'mahnung', `${MAHNSTUFEN[m.stufe]} erstellt`, [m.gebuehr_cent ? `Gebühr ${(m.gebuehr_cent / 100).toFixed(2).replace('.', ',')} €` : 'ohne Gebühr', m.versendet_am ? 'versendet' : 'noch nicht versendet'].join(' · '), 'erledigt', { mahnung_id: m.id });
    add(`${tag(m.frist)}T23:59:00`, 'frist', `Frist der ${MAHNSTUFEN[m.stufe]}`, fristZustand(m.frist) === 'offen' ? 'läuft noch' : fristZustand(m.frist) === 'faellig' && !ende ? 'verstrichen' : 'abgeschlossen', re.status === 'storniert' ? 'erledigt' : fristZustand(m.frist));
  }
  if (bezahlt) add(`${bezahlt}T23:58:00`, 'bezahlt', 'Bezahlt', re.umsatz_id ? 'Zahlungseingang auf dem Konto zugeordnet' : 'als bezahlt markiert');
  if (re.status === 'storniert') add(re.storniert_am || re.rechnungsdatum, 'storniert', 'Storniert', 'Termine sind wieder abrechenbar');
  // nächster Schritt bei offenen Rechnungen
  if (re.status === 'offen' && (re.mahnstufe ?? 0) < 3) {
    const letzte = [...mahnungen].sort((a, b) => b.stufe - a.stufe)[0];
    const ab = new Date(letzte ? letzte.frist : re.faellig_am); ab.setDate(ab.getDate() + karenzTage + 1);
    const stufe = (re.mahnstufe ?? 0) + 1;
    add(ab, 'naechste', `${MAHNSTUFEN[stufe]} möglich`, tagStr(ab) <= h ? 'jetzt fällig' : `ab diesem Tag (${karenzTage} Tage Karenz nach Fristende)`, tagStr(ab) <= h ? 'faellig' : 'kommend');
  }
  return ev.sort((a, b) => a.datum.localeCompare(b.datum) || a.zeit - b.zeit).map(({ zeit, ...e }) => e);
}
