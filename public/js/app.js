// Lernpraxis – Oberfläche. Klienten, Termine, Rechnungen und Umsätze kommen aus der API.

// ---------- Hilfen ----------
const ST = {
  geplant: ['Geplant', '--plan'],
  stattgefunden: ['Stattgefunden', '--ok'],
  abgesagt: ['Abgesagt (≥ 24 h)', '--abs'],
  ausgefallen: ['Ausgefallen (< 24 h gemeldet)', '--aus'],
  unentschuldigt: ['Unentschuldigt', '--unent'],
};
const BERECHNET = ['stattgefunden', 'ausgefallen', 'unentschuldigt'];
const ZART = { eltern: 'Eltern / Elternteil', jugendamt: 'Jugendamt (§ 35a SGB VIII)', sonstige: 'Sonstige' };

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = (n) => String(n).padStart(2, '0');
const tagStr = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; // lokales YYYY-MM-DD
const lokal = (d) => `${tagStr(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`; // für datetime-local
const fd = (d) => new Date(d).toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' });
const ft = (d) => new Date(d).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
const datum = (d) => new Date(d).toLocaleDateString('de-DE');
const eur = (n) => n.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
const st = (s) => `<span class="st" style="--c:var(${ST[s][1]})">${ST[s][0]}</span>`;
const heute = () => tagStr(new Date());
const tageBis = (d) => Math.ceil((new Date(tagStr(new Date(d))) - new Date(heute())) / 864e5);
const montag = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; };
const plusTage = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const monatName = (d) => d.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });

async function api(pfad, { methode = 'GET', daten } = {}) {
  const r = await fetch('/api' + pfad, {
    method: methode,
    headers: daten ? { 'content-type': 'application/json' } : undefined,
    body: daten ? JSON.stringify(daten) : undefined,
  });
  if (r.status === 204) return null;
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.fehler || `Fehler ${r.status}`);
  return j;
}

// ---------- Daten ----------
let KL = [];
let T = [];
let RE = []; // erstellte Rechnungen
let ZA = [], TH = [], TA = []; // TA = aktive Terminarten // Zahler und Therapien aller Klienten
let KONF = null; // Einstellungen Praxis/Mail/FinTS (nur auf der Einstellungsseite geladen)
let EIN = { stundensatz_cent: 0, ausfall_cent: 0, unentschuldigt_cent: 0 }; // allgemeine Sätze
const SATZ = [['stundensatz_cent', 'Therapiestunde (stattgefunden)'], ['ausfall_cent', 'Ausfall (< 24 h abgesagt)'], ['unentschuldigt_cent', 'Nicht erschienen (unentschuldigt)']];
const satzVon = (roh, f) => roh?.[f] ?? EIN[f];
const centAusEingabe = (v) => (String(v).trim() === '' ? null : Math.round(parseFloat(String(v).replace(',', '.')) * 100));
// Nächster Rechnungslauf: am 3. des Monats, 06:00 Uhr
// Zeitraum der Rechnungsliste nach Leistungsmonat: '' = alle, 'J2026' = Jahr, 'Q2026-4' = Quartal, 'M2026-10' = Monat
const quartalVon = (m) => `${m.slice(0, 4)}-${Math.ceil(+m.slice(5, 7) / 3)}`;
const imZeitraum = (m, z) => !z || (z[0] === 'J' ? m.startsWith(z.slice(1)) : z[0] === 'Q' ? quartalVon(m) === z.slice(1) : m === z.slice(1));
const zeitraumText = (z) => (!z ? 'Alle Zeiträume' : z[0] === 'J' ? `Jahr ${z.slice(1)}` : z[0] === 'Q' ? `${z.slice(6)}. Quartal ${z.slice(1, 5)}` : monatText(z.slice(1)));
// Vorheriger/nächster Zeitraum gleicher Art
function zeitraumSchritt(z, n) {
  if (z[0] === 'J') return `J${+z.slice(1) + n}`;
  if (z[0] === 'Q') { const i = +z.slice(1, 5) * 4 + +z.slice(6) - 1 + n; return `Q${Math.floor(i / 4)}-${(i % 4) + 1}`; }
  const d = new Date(+z.slice(1, 5), +z.slice(6, 8) - 1 + n, 1); return `M${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}
const reImMonat = () => (R.zeitraum ? RE.filter((r) => imZeitraum(r.leistungsmonat, R.zeitraum)) : RE);
const naechsterLauf = () => { const j = new Date(), d = new Date(j.getFullYear(), j.getMonth(), 3, 6); if (d <= j) d.setMonth(d.getMonth() + 1); return d; };
const R = { zeitraum: '', auswahlIds: new Set(), filter: 'ausgang', monat: null, vorschau: null, auswahl: null, mahn: [] };
const monatVon = (d) => tagStr(d).slice(0, 7);
const vormonatStr = () => { const d = new Date(); return monatVon(new Date(d.getFullYear(), d.getMonth() - 1, 1)); };
const monatText = (m) => monatName(new Date(m + '-01T12:00'));
const RST = { offen: ['Offen', '--plan'], bezahlt: ['Bezahlt', '--ok'], storniert: ['Storniert', '--abs'], ueberfaellig: ['Überfällig', '--unent'] };
// Filter der Rechnungsliste: Schlüssel, Bezeichnung, Bedingung
const ueberf = (r) => r.status === 'offen' && tagStr(new Date(r.faellig_am)) < heute();
const REFILTER = [
  ['ausgang', 'Rechnungsausgang', (r) => r.status === 'offen' && !r.versendet_am],
  ['alle', 'Alle', () => true],
  ['offen', 'Offen', (r) => r.status === 'offen'],
  ['ueberfaellig', 'Überfällig', ueberf],
  ['mahnfaellig', 'Mahnung fällig', (r) => R.mahn.some((m) => m.id === r.id)],
  ['m1', 'Zahlungserinnerung', (r) => r.status === 'offen' && r.mahnstufe === 1],
  ['m2', 'Mahnung', (r) => r.status === 'offen' && r.mahnstufe === 2],
  ['m3', 'Letzte Mahnung', (r) => r.status === 'offen' && r.mahnstufe === 3],
  ['bezahlt', 'Bezahlt', (r) => r.status === 'bezahlt'],
  ['storniert', 'Storniert', (r) => r.status === 'storniert'],
];
const MSTUFE = ['', 'Zahlungserinnerung', 'Mahnung', 'Letzte Mahnung'];
const reSt = (r) => { const s = r.status === 'offen' && tagStr(new Date(r.faellig_am)) < heute() ? 'ueberfaellig' : r.status; return `<span class="st" style="--c:var(${RST[s][1]})">${RST[s][0]}${r.status === 'offen' && r.mahnstufe ? ` · ${MSTUFE[r.mahnstufe]}` : ''}</span>`; };
const S = { woche: montag(new Date()), fehler: null };

function abbildenTermin(t) {
  const b = new Date(t.beginn);
  return { th: t.therapie_id, id: t.id, k: t.klient_id, d: lokal(b), beginn: b, dauer: Math.round((new Date(t.ende) - b) / 60000), s: t.status, txt: t.dokumentation || '', re: t.rechnung_id, art: t.terminart_name, preis: t.preis_cent, geplant: t.geplante_dauer_min };
}

const alterVon = (geb, heute = new Date()) => heute.getFullYear() - geb.getFullYear() - (heute < new Date(heute.getFullYear(), geb.getMonth(), geb.getDate()) ? 1 : 0);
// Suche über Name, Geburtsdatum (12.03.2016, 12.03., 2016), Schwerpunkt, Erziehungsberechtigte, Zahler und Therapie
function klientPasst(k, such) {
  if (!such) return true;
  const z = zahlerVon(k.id).map((x) => x.name).join(' '), th = therapienVon(k.id).map((t) => t.bezeichnung).join(' ');
  const geb = k.gebDatum ? `${k.gebDatum.split('-').reverse().join('.')} ${+k.gebDatum.slice(8)}.${+k.gebDatum.slice(5, 7)}.${k.gebDatum.slice(0, 4)}` : String(k.roh.geburtsjahr ?? '');
  const text = `${k.name} ${k.roh.nachname} ${k.roh.vorname} ${geb} ${k.schwer} ${k.roh.sorgeberechtigte ?? ''} ${z} ${th}`.toLowerCase();
  return such.toLowerCase().split(/\s+/).filter(Boolean).every((w) => text.includes(w));
}

function abbildenKlient(k) {
  const eigene = T.filter((t) => t.k === k.id).sort((a, b) => a.d.localeCompare(b.d));
  const neu = !eigene.some((t) => t.s === 'stattgefunden');
  const erster = neu ? eigene.find((t) => t.s !== 'abgesagt')?.d ?? null : null;
  return {
    id: k.id, roh: k,
    name: `${k.vorname} ${k.nachname}`,
    geb: k.geburtsjahr ?? '—',
    gebDatum: k.geburtsdatum ? tagStr(new Date(k.geburtsdatum)) : null, // YYYY-MM-DD
    gebText: k.geburtsdatum ? datum(k.geburtsdatum) : k.geburtsjahr ? `Jg. ${k.geburtsjahr}` : '',
    alter: k.geburtsdatum ? alterVon(new Date(k.geburtsdatum)) : k.geburtsjahr ? new Date().getFullYear() - k.geburtsjahr : null,
    schwer: k.schwerpunkt || '—',
    kontakt: [k.sorgeberechtigte, k.telefon].filter(Boolean).join(' · ') || '—',
    email: k.email,
    seit: k.aufnahme_datum,
    aktiv: k.aktiv,
    erster,
    material: k.material_noetig
      ? { versandt: !!k.material_versandt_am, am: k.material_versandt_am, wie: k.material_versand_art }
      : null,
  };
}

async function laden() {
  const [kl, te, re, ein, za, th, ta] = await Promise.all([api('/klienten?archiv=true'), api('/termine'), api('/rechnungen'), api('/einstellungen'), api('/zahler'), api('/therapien'), api('/terminarten')]);
  RE = re; EIN = ein; ZA = za; TH = th; TA = ta;
  T = te.map(abbildenTermin);
  KL = kl.map(abbildenKlient);
}

const kl = (id) => KL.find((k) => k.id == id) ?? { name: '(gelöscht)', roh: {} };
const zahlerVon = (kid) => ZA.filter((z) => z.klient_id === kid);
const therapienVon = (kid, nurAktive = false) => TH.filter((t) => t.klient_id === kid && (!nurAktive || t.aktiv));
const zahlerName = (id) => ZA.find((z) => z.id === id)?.name ?? null;
const therapieName = (id) => TH.find((t) => t.id === id)?.bezeichnung ?? '';
const therapieOptionen = (kid, gewaehlt) => therapienVon(kid, true).map((t) => `<option value="${t.id}" ${t.id == gewaehlt ? 'selected' : ''}>${esc(t.bezeichnung)}${t.zahler_id ? ' – ' + esc(zahlerName(t.zahler_id)) : ''}</option>`).join('');
// Material-Erinnerungen: Ersttermin steht noch bevor oder Material ist noch nicht verschickt
const materialListe = () => KL.filter((k) => k.aktiv && k.material && k.erster && (tageBis(k.erster) >= 0 || !k.material.versandt))
  .sort((a, b) => a.erster.localeCompare(b.erster));
const offen = () => materialListe().filter((k) => !k.material.versandt && tageBis(k.erster) <= 7);

// ---------- Rechnungseingang (Belege) ----------
const E = { tab: 'neu', liste: [], auswahl: null, kat: [], euer: null, jahr: new Date().getFullYear(), neu: 0, abruf: false };
const ETABS = [['neu', 'Postfach', 'neu'], ['eingang', 'Eingangsrechnungen', 'eingang,bezahlt'], ['verworfen', 'Verworfen', 'verworfen'], ['euer', 'EÜR-Übersicht']];
const VST = { wartet: 'wird ausgelesen …', laeuft: 'wird ausgelesen …', fehler: 'Auslesen fehlgeschlagen', fertig: '', offen: '' };
async function ladeEingangZaehler() { try { E.neu = (await api('/eingang/zaehler')).neu; } catch { /* Server nicht erreichbar */ } }
async function ladeEingang() {
  if (!E.kat.length) E.kat = await api('/eingang/kategorien');
  if (E.tab === 'euer') [E.euer, E.datev] = await Promise.all([api(`/eingang/euer?jahr=${E.jahr}`), api(`/datev/${E.jahr}`).catch(() => null)]);
  else E.liste = await api(`/eingang?status=${ETABS.find(([t]) => t === E.tab)[2]}`);
  if (E.auswahl) E.auswahl = await api(`/eingang/${E.auswahl.id}`).catch(() => null);
  await ladeEingangZaehler();
}
// Während Gemini ausliest, die Auswahl alle 3 s nachladen
let eingangTimer = null;
function eingangBeobachten() {
  clearTimeout(eingangTimer);
  if (!['wartet', 'laeuft'].includes(E.auswahl?.verarbeitung)) return;
  eingangTimer = setTimeout(async () => { if (location.hash !== '#eingang') return; await ladeEingang(); render(); eingangBeobachten(); }, 3000);
}
const katOptionen = (gew) => E.kat.map((k) => `<option value="${esc(k.name)}" title="${esc(k.beschreibung)}" ${k.name === gew ? 'selected' : ''}>${esc(k.name)}</option>`).join('');
const postenZeile = (p = { beschreibung: '', betrag_cent: 0, kategorie: 'Sonstige Ausgaben' }) => `<tr data-posten><td><input data-p="beschreibung" value="${esc(p.beschreibung)}" aria-label="Beschreibung"></td><td><input data-p="betrag" type="number" step="0.01" value="${(p.betrag_cent / 100).toFixed(2)}" aria-label="Betrag" style="width:7em"></td><td><select data-p="kategorie" aria-label="Kategorie">${katOptionen(p.kategorie)}</select></td><td><button type="button" class="sm" data-postenweg title="Posten entfernen">✕</button></td></tr>`;

// ---------- Umsätze (FinTS) ----------
const U = { von: '', bis: '', monat: '', neu: 0, liste: [], status: {}, neuIds: new Set(), nur: '' };
async function ladeUmsatzStatus() { try { U.status = await api('/umsaetze/status'); U.neu = U.status.neu; } catch { /* Server nicht erreichbar */ } }
async function ladeUmsaetze() {
  U.liste = await api('/umsaetze' + (U.nur ? `?nur=${U.nur}` : ''));
  U.liste.filter((u) => !u.gesehen).forEach((u) => U.neuIds.add(u.id));
  if (U.neu) { await api('/umsaetze/gesehen', { methode: 'POST' }); U.neu = 0; }
  try { U.auswertung = await api('/umsaetze/auswertung'); } catch { U.auswertung = null; }
}

// ---------- Diagramme (SVG) ----------
const CW = 720, CH = 220, PL = 56, PR = 8, PT = 10, PB = 26; // Zeichenfläche und Ränder
const eurKurz = (c) => (Math.abs(c) >= 100000 ? `${(c / 100000).toLocaleString('de-DE', { maximumFractionDigits: 1 })} T€` : eur(c / 100).replace(/,00/, ''));
// Gerundete Achsenschritte zwischen min und max (Cent)
function achse(min, max) {
  const roh = (max - min || 1) / 4, p = 10 ** Math.floor(Math.log10(roh)), s = [1, 2, 2.5, 5, 10].map((f) => f * p).find((x) => x >= roh);
  const a = Math.floor(min / s) * s, b = Math.ceil(max / s) * s;
  return { a, b, ticks: Array.from({ length: Math.round((b - a) / s) + 1 }, (_, i) => a + i * s) };
}
const yGitter = (ax, y) => `<g class="grid">${ax.ticks.map((t) => `<line x1="${PL}" x2="${CW - PR}" y1="${y(t)}" y2="${y(t)}" ${t === 0 ? 'style="stroke:var(--mute)"' : ''}/><text x="${PL - 6}" y="${y(t) + 4}" text-anchor="end">${eurKurz(t)}</text>`).join('')}</g>`;
const monatKurz = (m) => new Date(+m.slice(0, 4), +m.slice(5) - 1, 1).toLocaleDateString('de-DE', { month: 'short' }).replace('.', '');

// Ein- und Ausgaben je Monat als gruppierte Balken
function monatsDiagramm(monate) {
  const ax = achse(0, Math.max(1, ...monate.flatMap((m) => [m.ein_cent, m.aus_cent])));
  const y = (v) => PT + (CH - PT - PB) * (1 - (v - ax.a) / (ax.b - ax.a));
  const sp = (CW - PL - PR) / monate.length, bw = Math.max(2, Math.min(18, (sp - 6) / 2 - 1));
  const balken = (x, v, farbe) => { const h = Math.max(0, y(0) - y(v)), r = Math.min(4, bw / 2, h); return h ? `<path d="M${x},${y(0)}V${y(v) + r}q0,-${r} ${r},-${r}h${bw - 2 * r}q${r},0 ${r},${r}V${y(0)}Z" fill="var(${farbe})"/>` : ''; };
  const jede = Math.ceil(monate.length / 12);
  return `<svg class="chart" viewBox="0 0 ${CW} ${CH}" role="img" aria-label="Ein- und Ausgaben je Monat">${yGitter(ax, y)}
${monate.map((m, i) => { const x0 = PL + i * sp + sp / 2; return `${balken(x0 - bw - 1, m.ein_cent, '--ein')}${balken(x0 + 1, m.aus_cent, '--ausg')}${i % jede === 0 ? `<text x="${x0}" y="${CH - 8}" text-anchor="middle">${monatKurz(m.monat)}${m.monat.endsWith('-01') || i === 0 ? ` ${m.monat.slice(2, 4)}` : ''}</text>` : ''}<rect class="hit${U.monat === m.monat ? ' on' : ''}" data-umonat="${m.monat}" x="${PL + i * sp}" y="${PT}" width="${sp}" height="${CH - PT - PB}" data-tip="${esc(`${monatText(m.monat)}\nEinnahmen ${eur(m.ein_cent / 100)}\nAusgaben ${eur(m.aus_cent / 100)}\nÜberschuss ${eur((m.ein_cent - m.aus_cent) / 100)}
Klicken, um die Liste zu filtern`)}"/>`; }).join('')}</svg>`;
}

// Kontostand über die Zeit (Stufenlinie, Stand am Ende jedes Buchungstages)
function verlaufDiagramm(verlauf) {
  const t = (d) => new Date(d).getTime(), t0 = t(verlauf[0].datum), t1 = Math.max(t(verlauf.at(-1).datum), t0 + 864e5);
  const ax = achse(Math.min(...verlauf.map((v) => v.saldo_cent)), Math.max(...verlauf.map((v) => v.saldo_cent)));
  const y = (v) => PT + (CH - PT - PB) * (1 - (v - ax.a) / (ax.b - ax.a)), x = (d) => PL + (CW - PL - PR) * (t(d) - t0) / (t1 - t0);
  const pfad = verlauf.map((v, i) => `${i ? `H${x(v.datum)}` : `M${x(v.datum)},${y(v.saldo_cent)}`}V${y(v.saldo_cent)}`).join('');
  const monate = []; // Monatsanfänge im Zeitraum als Achsenbeschriftung
  for (let d = new Date(new Date(t0).getFullYear(), new Date(t0).getMonth() + 1, 1); d.getTime() <= t1; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) monate.push(d);
  const jede = Math.ceil(monate.length / 12);
  const sel = U.von && U.bis ? [Math.max(PL, x(`${U.von}T00:00`)), Math.min(CW - PR, x(`${U.bis}T23:59`))] : null;
  return `<svg class="chart verlauf" viewBox="0 0 ${CW} ${CH}" role="img" aria-label="Kontoverlauf – Bereich mit der Maus markieren, um die Liste zu filtern" data-t0="${t0}" data-t1="${t1}" data-x0="${PL}" data-x1="${CW - PR}">${yGitter(ax, y)}${sel && sel[1] > sel[0] ? `<rect class="auswahl" x="${sel[0]}" y="${PT}" width="${sel[1] - sel[0]}" height="${CH - PT - PB}"/>` : ''}<rect class="ziehen" x="${PL}" y="${PT}" width="0" height="${CH - PT - PB}"/>
${monate.filter((_, i) => i % jede === 0).map((d) => `<text x="${x(d)}" y="${CH - 8}" text-anchor="middle">${monatKurz(monatVon(d))}${d.getMonth() === 0 ? ` ${String(d.getFullYear()).slice(2)}` : ''}</text>`).join('')}
<path d="${pfad}" fill="none" stroke="var(--ein)" stroke-width="2" stroke-linejoin="round"/>
${verlauf.map((v, i) => { const a = i ? (x(verlauf[i - 1].datum) + x(v.datum)) / 2 : PL, b = i < verlauf.length - 1 ? (x(v.datum) + x(verlauf[i + 1].datum)) / 2 : CW - PR; return `<rect class="hit" x="${a}" y="${PT}" width="${Math.max(1, b - a)}" height="${CH - PT - PB}" data-tip="${esc(`${datum(v.datum)}\nKontostand ${eur(v.saldo_cent / 100)}`)}"/>`; }).join('')}</svg>`;
}

// Tooltip für alle Diagramme
const tip = Object.assign(document.createElement('div'), { className: 'chart-tip' });
document.body.append(tip);
document.addEventListener('pointermove', (e) => {
  const h = e.target.closest?.('[data-tip]');
  if (!h) { tip.style.display = 'none'; return; }
  tip.textContent = h.dataset.tip; tip.style.display = 'block';
  const r = tip.getBoundingClientRect();
  tip.style.left = `${Math.min(e.clientX + 14, innerWidth - r.width - 8)}px`; tip.style.top = `${Math.max(8, e.clientY - r.height - 12)}px`;
});

async function ladeVorschau() {
  const m = R.monat ||= vormonatStr();
  try { [R.vorschau, R.mahn] = await Promise.all([api(`/rechnungen/vorschau?monat=${m}`), api('/rechnungen/mahnungen/faellig')]); } catch (e) { S.fehler = e.message; }
}

// ---------- Ansichten ----------
const V = {
  uebersicht() {
    const h = heute();
    const heuteT = T.filter((t) => t.d.startsWith(h)).sort((a, b) => a.d.localeCompare(b.d));
    const rem = materialListe();
    const stunde = new Date().getHours();
    const gruss = stunde < 11 ? 'Guten Morgen' : stunde < 18 ? 'Guten Tag' : 'Guten Abend';
    const lauf = naechsterLauf();
    const abrechenbar = KL.filter((k) => k.aktiv && T.some((t) => t.k === k.id && t.d.startsWith(h.slice(0, 7)) && t.s !== 'abgesagt')).length;
    const vs = R.vorschau?.liste?.filter((v) => !v.bereits_berechnet && v.betrag_cent > 0 && v.zahler_name) ?? [];
    const unversandt = RE.filter((r) => r.status === 'offen' && !r.versendet_am);
    const aufgabe = (links, text, knopf) => `<div class="rem"><div class="days due" style="font-size:16px">${links}</div><div>${text}</div>${knopf}</div>`;
    const aufgaben = [
      ...rem.map((k) => {
        const d = tageBis(k.erster), m = k.material;
        return `<div class="rem"><div class="days ${!m.versandt && d <= 7 ? 'due' : ''}">${d}<small>Tage</small></div><div><b>Material: ${esc(k.name)}</b><br><span class="sub" style="margin:0">Ersttermin ${fd(k.erster)}, ${ft(k.erster)} · ${m.versandt ? `versandt am ${datum(m.am)} (${esc(m.wie)})` : d <= 7 ? '<span class="mark">jetzt versenden</span>' : 'Erinnerung ab ' + datum(new Date(k.erster) - 7 * 864e5)}</span></div>${m.versandt ? '<span class="st" style="--c:var(--ok)">erledigt</span>' : `<button data-send="${k.id}" ${d > 7 ? 'disabled' : ''}>Versandt</button>`}</div>`;
      }),
      vs.length ? aufgabe(vs.length, `<b>Rechnungen erstellen</b><br><span class="sub" style="margin:0">${monatText(R.vorschau.monat)}: ${vs.length === 1 ? '1 Rechnung' : vs.length + ' Rechnungen'} noch nicht erstellt</span>`, '<button data-go="rechnungen" data-ansicht="erstellen">Erstellen</button>') : '',
      ...unversandt.map((r) => aufgabe('✉', `<b>Rechnung versenden: ${esc(r.klient_name)}</b><br><span class="sub" style="margin:0">${esc(r.nummer)} · ${eur(r.betrag_cent / 100)}</span>`, `<button data-mail="/rechnungen/${r.id}">Senden</button>`)),
      ...R.mahn.map((r) => aufgabe('!', `<b>${esc(r.faellige_art)}: ${esc(r.klient_name)}</b><br><span class="sub" style="margin:0">${esc(r.nummer)} · ${eur(r.betrag_cent / 100)} · fällig seit ${datum(r.faellig_am)}</span>`, `<button data-mahnen="${r.id}">Erstellen</button>`)),
    ].filter(Boolean);
    return `<h1>${gruss}</h1><p class="sub">${new Date().toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })} · ${heuteT.length === 1 ? "1 Termin" : heuteT.length + " Termine"} heute</p>
<div class="grid"><div class="card"><h2>Heute</h2>${heuteT.map((t) => `<div class="rem"><div class="days" style="font-size:16px">${ft(t.d)}</div><div><b>${esc(kl(t.k).name)}</b><br>${st(t.s)}</div><button data-term="${t.id}">Status</button></div>`).join('') || '<p class="sub">Heute keine Termine.</p>'}</div>
<div class="card"><h2>Aufgaben</h2>${aufgaben.join('') || '<p class="sub">Keine offenen Aufgaben.</p>'}
<h2 style="margin-top:20px">Nächster Rechnungslauf</h2><p style="margin:0">${lauf.toLocaleDateString('de-DE', { weekday: 'long' })}, <b>${datum(lauf)}, 06:00 Uhr</b> – für den Vormonat${EIN.autoversand ? ', Versand automatisch' : ', danach Prüfung im Rechnungsausgang'}.<br><span class="sub">Vorschau: ${abrechenbar} Rechnungen</span></p><button data-go="rechnungen" style="margin-top:10px">Vorschau ansehen</button></div></div>`;
  },

  kalender() {
    const tage = [0, 1, 2, 3, 4, 5, 6].map((i) => plusTage(S.woche, i));
    const woche = T.filter((t) => t.beginn >= S.woche && t.beginn < plusTage(S.woche, 7));
    // Wochenende nur zeigen, wenn dort Termine liegen
    const sichtbar = tage.filter((d, i) => i < 5 || woche.some((t) => t.d.startsWith(tagStr(d))));
    const stunden = woche.flatMap((t) => [t.beginn.getHours(), t.beginn.getHours() + Math.ceil((t.beginn.getMinutes() + t.dauer) / 60)]);
    const h0 = Math.min(13, ...stunden), h1 = Math.max(19, ...stunden);
    const hs = Array.from({ length: h1 - h0 }, (_, i) => h0 + i);
    const kw = (() => { const d = plusTage(S.woche, 3); const j = new Date(d.getFullYear(), 0, 4); return 1 + Math.round(((d - montag(j)) / 864e5) / 7); })();
    const ev = (t, raster) => {
      const top = (t.beginn.getHours() + t.beginn.getMinutes() / 60 - h0) * 56;
      const pos = raster ? `top:${top + 2}px;height:${t.dauer / 60 * 56 - 4}px;` : '';
      // im Raster: ziehen = verschieben, Griffe oben/unten = Beginn/Ende ändern (nicht bei abgerechneten Terminen)
      const ziehbar = raster && !t.re;
      return `<button class="ev ${t.s === 'abgesagt' ? 'x' : ''}${ziehbar ? ' ziehbar' : ''}" style="${pos}--c:var(${ST[t.s][1]})" data-term="${t.id}"${t.re ? ' title="abgerechnet – nicht verschiebbar"' : ''}>${ziehbar ? '<span class="griff oben" data-griff="oben"></span>' : ''}<b>${esc(kl(t.k).name)}</b><span class="zeit">${ft(t.d)} – ${ft(new Date(+t.beginn + t.dauer * 60000))}</span> · ${ST[t.s][0].split(' ')[0]}${ziehbar ? '<span class="griff unten" data-griff="unten"></span>' : ''}</button>`;
    };
    return `<div class="row"><div><h1>Kalender</h1><p class="sub">KW ${kw} · ${datum(S.woche)} – ${datum(plusTage(S.woche, 6))} · Termin antippen für den Status · ziehen zum Verschieben, Rand oben/unten ziehen für Beginn/Ende</p></div><span class="sp"></span><button data-woche="-1" aria-label="Vorige Woche">‹</button><button data-woche="0">Heute</button><button data-woche="1" aria-label="Nächste Woche">›</button><button class="pri" data-neutermin>+ Termin</button></div>
<div class="cal" style="grid-template-columns:48px repeat(${sichtbar.length},minmax(0,1fr))"><div class="h"></div>${sichtbar.map((d) => `<div class="h ${tagStr(d) === heute() ? 'today' : ''}">${fd(d)}</div>`).join('')}
<div>${hs.map((h) => `<div class="t">${h}:00</div>`).join('')}</div>
${sichtbar.map((d) => `<div class="col" data-tag="${tagStr(d)}" data-h0="${h0}" style="height:${hs.length * 56}px">${woche.filter((t) => t.d.startsWith(tagStr(d))).map((t) => ev(t, true)).join('')}</div>`).join('')}</div>
<div class="agenda">${sichtbar.map((d) => { const ts = woche.filter((t) => t.d.startsWith(tagStr(d))).sort((a, b) => a.d.localeCompare(b.d)); return `<div class="tag ${tagStr(d) === heute() ? 'today' : ''}">${fd(d)}</div>${ts.map((t) => ev(t, false)).join('') || '<div class="sub">keine Termine</div>'}`; }).join('')}</div>
<div class="row" style="margin-top:12px">${Object.keys(ST).map(st).join('')}</div>`;
  },

  klienten() {
    const such = (S.suche || '').trim(), arch = !!V._arch;
    const zeig = KL.filter((k) => (arch ? !k.aktiv : k.aktiv) && klientPasst(k, such));
    const nAktiv = KL.filter((k) => k.aktiv).length, nArch = KL.length - nAktiv;
    const naechster = (k) => T.filter((t) => t.k === k.id && t.s === 'geplant' && t.beginn >= new Date()).sort((a, b) => a.d.localeCompare(b.d))[0];
    return `<div class="row"><h1 style="margin:0">Klienten</h1><span class="sp"></span><button class="pri" data-edit="0">+ Neuer Klient</button></div>
<div class="row kl-werkzeug"><div class="tabs" style="margin:0;border:0"><button data-arch="0" class="${arch ? '' : 'on'}">Aktiv (${nAktiv})</button><button data-arch="1" class="${arch ? 'on' : ''}">Archiv (${nArch})</button></div><span class="sp"></span><input type="search" data-suche placeholder="Name, Geburtsdatum, Schwerpunkt …" aria-label="Klienten suchen" value="${esc(S.suche || '')}"></div>
<div class="card kl-liste"><div class="kl-zeile kl-kopf"><span>Name</span><span>Geburtsdatum</span><span>Schwerpunkt</span><span>Therapie · Zahler</span><span>${arch ? 'Letzter Termin' : 'Nächster Termin'}</span><span></span></div>
${zeig.map((k) => {
      const n = arch ? T.filter((t) => t.k === k.id && t.beginn < new Date()).sort((a, b) => b.d.localeCompare(a.d))[0] : naechster(k);
      const th = therapienVon(k.id, !arch)[0];
      return `<div class="kl-zeile click" data-kl="${k.id}" role="link" tabindex="0"><b title="${esc(k.name)}">${esc(k.name)}</b><span>${k.gebText ? `${esc(k.gebText)}${k.alter != null ? ` <span class="sub">(${k.alter})</span>` : ''}` : '<span class="sub">—</span>'}</span><span>${esc(k.schwer)}</span><span title="${esc(therapienVon(k.id, !arch).map((t) => `${t.bezeichnung} · ${zahlerName(t.zahler_id) ?? 'kein Zahler'}`).join('\n'))}">${th ? `${esc(th.bezeichnung)} <span class="sub">· ${esc(zahlerName(th.zahler_id) ?? 'kein Zahler')}</span>${therapienVon(k.id, !arch).length > 1 ? ` <span class="sub">+${therapienVon(k.id, !arch).length - 1}</span>` : ''}` : '<span class="sub">keine Therapie</span>'}</span><span>${n ? `${fd(n.d)}, ${ft(n.d)}` : '<span class="sub">—</span>'}</span><span class="aktion"><button class="sm" data-archive="${k.id}">${k.aktiv ? 'Archivieren' : 'Reaktivieren'}</button></span></div>`;
    }).join('') || `<p class="sub" style="padding:12px 16px;margin:0">${such ? `Keine Treffer für „${esc(such)}“${arch ? ' im Archiv' : ' unter den aktiven Klienten'}.` : arch ? 'Das Archiv ist leer.' : 'Noch keine aktiven Klienten.'}</p>`}</div>`;
  },


  akte() {
    const k = kl(V._k), alle = T.filter((t) => t.k === k.id).sort((a, b) => b.d.localeCompare(a.d)), jetzt = new Date();
    const kommend = alle.filter((t) => t.beginn >= jetzt && t.s === 'geplant').reverse();
    const vergangen = alle.filter((t) => !(t.beginn >= jetzt && t.s === 'geplant'));
    const ohneDoku = vergangen.filter((t) => t.s === 'stattgefunden' && !t.txt);
    const ohneStatus = vergangen.filter((t) => t.s === 'geplant');
    const filter = V._vf || 'alle';
    const liste = filter === 'doku' ? ohneDoku : filter === 'status' ? ohneStatus : vergangen;
    const mehrereTh = therapienVon(k.id).length > 1;
    const reK = RE.filter((r) => r.klient_id === k.id).sort((a, b) => b.leistungsmonat.localeCompare(a.leistungsmonat));
    const offen = reK.filter((r) => r.status === 'offen'), offenCent = offen.reduce((a, r) => a + r.betrag_cent, 0);
    const anz = (s) => alle.filter((t) => t.s === s).length;
    const z = zahlerVon(k.id)[0];
    const kontakt = k.roh;

    // Verlauf nach Monaten gruppiert
    let monat = '';
    const eintraege = liste.map((t) => {
      const m = monatName(t.beginn), kopf = m !== monat ? `<h3 class="monat">${m}</h3>` : '';
      monat = m;
      return `${kopf}<div class="eintrag" style="--c:var(${ST[t.s][1]})"><div class="wann"><b>${fd(t.d)}</b><span>${ft(t.d)} · ${t.dauer} min</span></div>
<div class="was"><div>${st(t.s)}${t.art ? ` <span class="sub">${esc(t.art)}</span>` : ''}${mehrereTh ? ` <span class="sub">· ${esc(therapieName(t.th))}</span>` : ''}</div>${t.s === 'stattgefunden' || t.txt ? `<p class="${t.txt ? 'doku' : 'doku leer'}">${t.txt ? esc(t.txt) : 'Noch keine Dokumentation'}</p>` : ''}</div>
<button data-term="${t.id}" class="sm">${t.s === 'stattgefunden' && !t.txt ? 'Dokumentieren' : t.s === 'geplant' ? 'Status' : 'Öffnen'}</button></div>`;
    }).join('');

    const kpi = (wert, text, warn) => `<div class="kpi${warn ? ' warn' : ''}"><b>${wert}</b><span>${text}</span></div>`;
    return `<a href="#klienten" class="zurueck">‹ Alle Klienten</a>
<div class="row akte-kopf"><div><h1>${esc(k.name)}${k.aktiv ? '' : ' <span class="st" style="--c:var(--abs)">archiviert</span>'}</h1><p class="sub">${[k.schwer !== '—' && esc(k.schwer), k.gebText && `${k.gebDatum ? 'geb. ' : ''}${esc(k.gebText)}${k.alter != null ? ` (${k.alter} Jahre)` : ''}`, k.seit && `in Therapie seit ${datum(k.seit)}`].filter(Boolean).join(' · ') || 'Keine weiteren Angaben'}</p></div><span class="sp"></span>
<button data-edit="${k.id}">Bearbeiten</button><button data-archive="${k.id}">${k.aktiv ? 'Archivieren' : 'Reaktivieren'}</button>${k.aktiv ? `<button class="pri" data-neutermin="${k.id}">+ Termin</button>` : ''}</div>
<div class="kpis card">${kpi(kommend[0] ? `${fd(kommend[0].d)}, ${ft(kommend[0].d)}` : '—', 'nächster Termin')}${kpi(anz('stattgefunden'), 'Stunden gehalten')}${kpi(anz('ausgefallen') + anz('unentschuldigt'), 'Ausfälle (berechnet)', anz('unentschuldigt') > 1)}${kpi(ohneDoku.length, 'ohne Dokumentation', ohneDoku.length > 0)}${kpi(offen.length ? eur(offenCent / 100) : '—', `offen${offen.length ? ` (${offen.length} Rechnung${offen.length > 1 ? 'en' : ''})` : ''}`, offen.some(ueberf))}</div>
<div class="akte">
<section class="card"><div class="row"><h2 style="margin:0">Verlauf</h2><span class="sp"></span>${[['alle', `Alle (${vergangen.length})`], ['doku', `Ohne Doku (${ohneDoku.length})`], ['status', `Ohne Status (${ohneStatus.length})`]].filter(([w], i) => !i || w === filter || (w === 'doku' ? ohneDoku : ohneStatus).length).map(([w, l]) => `<button class="sm${filter === w ? ' pri' : ''}" data-vf="${w}">${l}</button>`).join('')}</div>
${kommend.length ? `<h3 class="monat">Geplant</h3>${kommend.slice(0, 3).map((t) => `<div class="eintrag" style="--c:var(--plan)"><div class="wann"><b>${fd(t.d)}</b><span>${ft(t.d)} · ${t.dauer} min</span></div><div class="was">${t.art ? esc(t.art) : '<span class="sub">Termin</span>'}${mehrereTh ? ` <span class="sub">· ${esc(therapieName(t.th))}</span>` : ''}</div><button data-term="${t.id}" class="sm">Öffnen</button></div>`).join('')}${kommend.length > 3 ? `<p class="sub">und ${kommend.length - 3} weitere geplante Termine</p>` : ''}` : ''}
${eintraege || `<p class="sub">${filter === 'alle' ? 'Noch keine vergangenen Termine.' : 'Nichts offen – gut so.'}</p>`}</section>
<aside>
<section class="card"><div class="row"><h2 style="margin:0">Kontakt</h2></div>
<dl class="info"><dt>Erziehungsberechtigte</dt><dd>${esc(kontakt.sorgeberechtigte || z?.name || '—')}</dd>${kontakt.telefon ? `<dt>Telefon</dt><dd><a href="tel:${esc(kontakt.telefon)}">${esc(kontakt.telefon)}</a></dd>` : ''}${kontakt.email ? `<dt>E-Mail</dt><dd><a href="mailto:${esc(kontakt.email)}">${esc(kontakt.email)}</a></dd>` : ''}${k.material ? `<dt>Material</dt><dd>${k.material.versandt ? `verschickt am ${datum(k.material.am)} (${esc(k.material.wie)})` : '<b style="color:var(--aus)">noch nicht verschickt</b>'}</dd>` : ''}</dl></section>
<section class="card"><div class="row"><h2 style="margin:0">Therapie &amp; Zahler</h2><span class="sp"></span><button class="sm" data-therapie="0" data-klient="${k.id}" ${zahlerVon(k.id).length ? '' : 'disabled title="Zuerst einen Zahler anlegen"'}>+ Therapie</button></div>
${therapienVon(k.id).map((t) => `<div class="zeile"><div><b>${esc(t.bezeichnung)}</b>${t.aktiv ? '' : ' <span class="st" style="--c:var(--abs)">beendet</span>'}<span class="sub">zahlt: ${esc(zahlerName(t.zahler_id) ?? '— bitte zuordnen')} · ${eur(satzVon(t, 'stundensatz_cent') / 100)}${SATZ.some(([f]) => t[f] != null) ? ' (eigene Beträge)' : ''}</span></div><button class="sm" data-therapie="${t.id}" data-klient="${k.id}">Ändern</button></div>`).join('') || '<p class="sub">Noch keine Therapie – ohne Therapie wird nichts abgerechnet.</p>'}
<div class="row" style="margin-top:12px"><h3 style="margin:0">Zahler</h3><span class="sp"></span><button class="sm" data-zahler="0" data-klient="${k.id}">+ Zahler</button></div>
${zahlerVon(k.id).map((x) => `<div class="zeile"><div><b>${esc(x.name)}</b><span class="sub">${esc(ZART[x.art] ?? x.art)}${x.email ? ` · ${esc(x.email)}` : ' · <b style="color:var(--aus)">keine E-Mail</b>'}${x.adresse ? '' : ' · <b style="color:var(--aus)">Adresse fehlt</b>'}</span></div><button class="sm" data-zahler="${x.id}" data-klient="${k.id}">Ändern</button></div>`).join('') || '<p class="sub">Noch kein Zahler – meist ein Elternteil.</p>'}</section>
<section class="card"><div class="row"><h2 style="margin:0">Rechnungen</h2></div>
${reK.slice(0, 6).map((r) => `<div class="zeile"><div><a href="/api/rechnungen/${r.id}/pdf" target="_blank"><b>${esc(r.nummer)}</b></a><span class="sub">${monatText(r.leistungsmonat)} · ${eur(r.betrag_cent / 100)}</span></div>${reSt(r)}</div>`).join('') || '<p class="sub">Noch keine Rechnungen.</p>'}
${reK.length > 6 ? `<p class="sub">${reK.length - 6} ältere unter <a href="#rechnungen">Rechnungen</a></p>` : ''}</section>
</aside></div>`;
  },


  rechnungen() {
    const m = R.monat ||= vormonatStr();
    const vs = R.vorschau?.monat === m ? R.vorschau.liste : null;
    const neu = vs?.filter((v) => !v.bereits_berechnet && v.betrag_cent > 0 && v.zahler_name) ?? [];
    const p = R.auswahl;
    // Filter nach Leistungsmonat ('' = alle Monate); gilt für Liste, Zähler und Sammelversand
    // Auswahl: laufendes Jahr, Vorjahr und Quartale/Monate mit Rechnungen (plus die laufenden), neueste zuerst
    const jetztM = monatVon(new Date()), jahr = +jetztM.slice(0, 4);
    const lm = [...new Set([...RE.map((r) => r.leistungsmonat), jetztM, vormonatStr()])].sort().reverse();
    const jahre = [...new Set([jahr, jahr - 1, ...lm.map((m) => +m.slice(0, 4))])].sort((a, b) => b - a);
    const quartale = [...new Set(lm.map(quartalVon))];
    const opt = (v, l) => `<option value="${v}" ${v === R.zeitraum ? 'selected' : ''}>${l}</option>`;
    const zeitraumAuswahl = `<div class="zeitraum"><button class="sm" data-zschritt="-1" ${R.zeitraum ? '' : 'disabled'} aria-label="Vorheriger Zeitraum">‹</button><select data-zeitraum aria-label="Zeitraum">${opt('', 'Alle Zeiträume')}<optgroup label="Jahr">${jahre.map((j) => opt(`J${j}`, `${j}${j === jahr ? ' (laufendes Jahr)' : ''}`)).join('')}</optgroup><optgroup label="Quartal">${quartale.map((q) => opt(`Q${q}`, `${q.slice(5)}. Quartal ${q.slice(0, 4)}${q === quartalVon(jetztM) ? ' (laufend)' : ''}`)).join('')}</optgroup><optgroup label="Monat">${lm.map((m) => opt(`M${m}`, `${monatText(m)}${m === jetztM ? ' (laufend)' : ''}`)).join('')}</optgroup></select><button class="sm" data-zschritt="1" ${R.zeitraum ? '' : 'disabled'} aria-label="Nächster Zeitraum">›</button>
<span class="schnell">${[['', 'Alle'], [`J${jahr}`, String(jahr)], [`Q${quartalVon(jetztM)}`, 'Dieses Quartal'], [`M${vormonatStr()}`, 'Vormonat']].map(([v, l]) => `<button class="sm${R.zeitraum === v ? ' pri' : ''}" data-zsetzen="${v}">${l}</button>`).join('')}</span></div>`;
    const reM = reImMonat();
    const reListe = reM.filter((REFILTER.find(([w]) => w === R.filter) ?? REFILTER[0])[2]);
    const monate = Array.from({ length: 12 }, (_, i) => { const d = new Date(); return monatVon(new Date(d.getFullYear(), d.getMonth() - i, 1)); });
    return `<div class="row"><div><h1>Rechnungen</h1></div><span class="sp"></span><button data-abgleich>Zahlungen abgleichen</button></div>
<div class="grid" style="grid-template-columns:${p ? 'minmax(0,3fr) minmax(300px,2fr)' : '1fr'}"><div class="card" style="min-width:0"><h2 style="margin:0">Abrechnung</h2>
<div class="row" style="flex-wrap:wrap;gap:6px;margin:10px 0">${[['erstellen', 'Zu erstellen', null], ...REFILTER].map(([w, l, fn]) => { const n = fn ? reM.filter(fn).length : neu.length; return n || ['alle', 'erstellen', R.filter].includes(w) ? `<button data-refilter="${w}" class="sm${R.filter === w ? ' pri' : ''}">${l} (${n})</button>` : ''; }).join('')}</div>
${R.filter !== 'erstellen' ? `<div class="row" style="margin:0 0 8px;flex-wrap:wrap">${zeitraumAuswahl}${R.zeitraum ? `<span class="sub" style="margin:0">${reListe.length} Rechnung${reListe.length === 1 ? '' : 'en'} · ${eur(reListe.reduce((a, r) => a + r.betrag_cent, 0) / 100)}</span>` : ''}</div>` : ''}${R.filter === 'erstellen' ? `<div class="row"><span class="sub" style="margin:0">Leistungsmonat</span><span class="sp"></span><select data-remonat style="width:auto">${monate.map((x) => `<option value="${x}" ${x === m ? 'selected' : ''}>${monatText(x)}</option>`).join('')}</select></div>
<table class="stack"><thead><tr><th>Klient</th><th class="n">Einheiten</th><th class="n">Betrag</th></tr></thead><tbody>${!vs ? '<tr><td colspan="3" class="sub">Lädt …</td></tr>' : vs.map((v) => `<tr><td>${esc(v.name)}<br><span class="sub">${esc(v.therapie)} · an ${v.zahler_name ? esc(v.zahler_name) : '<b style="color:var(--unent)">kein Zahler</b>'}</span>${v.bereits_berechnet ? ' <span class="st" style="--c:var(--ok)">berechnet</span>' : ''}${v.ohne_status ? ` <span class="st" style="--c:var(--aus)">${v.ohne_status} ohne Status</span>` : ''}${v.noch_geplant ? ` <span class="sub">${v.noch_geplant} noch geplant</span>` : ''}</td><td class="n">${v.positionen.length}</td><td class="n">${eur(v.betrag_cent / 100)}</td></tr>`).join('') || '<tr><td colspan="3" class="sub">Nichts abzurechnen.</td></tr>'}</tbody></table>
<p class="hint">Berechnet werden stattgefundene, ausgefallene und unentschuldigte Termine. Vergangene Termine ohne Status bitte vorher prüfen – sie werden nicht berechnet.</p><div class="row"><span class="sp"></span><button class="pri" data-lauf ${neu.length ? '' : 'disabled'}>${neu.length} Rechnung${neu.length === 1 ? '' : 'en'} erstellen</button></div>` : `${R.filter === 'ausgang' ? (() => { const ids = reListe.map((r) => r.id).filter((id) => R.auswahlIds.has(id)); return `${reListe.length ? `<div class="row" style="margin-bottom:6px"><label style="display:flex;gap:8px;align-items:center;margin:0"><input type="checkbox" data-alleaus ${ids.length === reListe.length ? 'checked' : ''} style="width:auto;min-height:0"> alle auswählen</label><span class="sp"></span><button class="pri" data-sammelversand ${ids.length ? '' : 'disabled'}>${ids.length} Rechnung${ids.length === 1 ? '' : 'en'} senden</button></div>` : ''}`; })() : ''}${R.filter === 'mahnfaellig' ? '<p class="hint">Vor dem Mahnen „Zahlungen abgleichen“, damit eingegangene Zahlungen berücksichtigt sind.</p>' : ''}<table class="stack"><thead><tr><th>Nr.</th><th>Klient</th><th>Monat</th><th class="n">Betrag</th><th>Status</th></tr></thead><tbody>${reListe.map((r) => `<tr data-re="${r.id}" style="cursor:pointer${p?.id === r.id ? ';background:var(--mainbg)' : ''}"><td>${R.filter === 'ausgang' ? `<input type="checkbox" data-ausw="${r.id}" ${R.auswahlIds.has(r.id) ? 'checked' : ''} aria-label="${esc(r.nummer)} auswählen" style="width:auto;min-height:0;margin-right:8px">` : ''}${esc(r.nummer)}${R.filter === 'ausgang' && !r.empfaenger_email ? ' <span class="st" style="--c:var(--aus)" title="Zahler hat keine E-Mail-Adresse">keine E-Mail</span>' : ''}${r.versendet_am ? ' <span title="per E-Mail versendet">✉</span>' : ''}</td><td>${esc(r.klient_name)}${r.therapie_bezeichnung ? `<br><span class="sub">${esc(r.therapie_bezeichnung)}</span>` : ''}</td><td>${monatText(r.leistungsmonat)}</td><td class="n">${eur(r.betrag_cent / 100)}</td><td>${reSt(r)}${R.filter === 'mahnfaellig' ? `<br><button data-mahnen="${r.id}" class="sm" style="margin-top:4px">${esc(R.mahn.find((x) => x.id === r.id)?.faellige_art ?? 'Mahnung')} erstellen</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="5" class="sub">Keine Rechnungen in dieser Ansicht.</td></tr>'}</tbody></table>`}</div>
<div>${p ? `<div class="paper"><div class="row"><div><h3>Rechnung ${esc(p.nummer)}</h3>${datum(p.rechnungsdatum)} · fällig ${datum(p.faellig_am)}</div><span class="sp"></span>${reSt(p)}</div><p style="white-space:pre-line">${esc(p.empfaenger)}</p><p>betr. ${esc(p.klient_name)} · Leistungszeitraum: ${monatText(p.leistungsmonat)}</p>
<table><thead><tr><th>Datum</th><th>Leistung</th><th class="n">Betrag</th></tr></thead><tbody>${p.positionen.map((x) => `<tr><td>${datum(x.datum)}</td><td>${esc(x.beschreibung)}</td><td class="n">${eur(x.betrag_cent / 100)}</td></tr>`).join('')}<tr><td></td><td><b>Gesamt</b></td><td class="n"><b>${eur(p.betrag_cent / 100)}</b></td></tr></tbody></table>
</div>${p.verlauf?.length ? `<h3 style="margin:16px 0 6px">Verlauf</h3><ol class="reverlauf">${p.verlauf.map((e) => { const m = e.mahnung_id && p.mahnungen.find((x) => x.id === e.mahnung_id); return `<li class="${e.zustand}"><span class="ic" aria-hidden="true">${{ erstellt: '＋', versand: e.zustand === 'fehler' ? '!' : '✉', frist: '⏱', mahnung: '§', bezahlt: '✓', storniert: '✕', naechste: '→' }[e.art] ?? '•'}</span><div><div class="kopf"><b>${esc(e.titel)}</b><span>${datum(e.datum)}</span></div><div class="sub" style="margin:0">${esc(e.text)}</div>${m ? `<div class="row" style="gap:6px;margin-top:4px"><a class="btn sm" href="/api/rechnungen/mahnungen/${m.id}/pdf" target="_blank">PDF</a>${m.versendet_am ? '' : `<button class="sm" data-mail="/rechnungen/mahnungen/${m.id}">Per E-Mail senden</button>`}</div>` : ''}</div></li>`; }).join('')}</ol>` : ''}
<div class="row" style="margin-top:8px"><a href="/api/rechnungen/${p.id}/pdf" target="_blank" class="btn">PDF öffnen</a>${p.status !== 'storniert' ? `<button data-mail="/rechnungen/${p.id}">${p.versendet_am ? 'Erneut per E-Mail' : 'Per E-Mail senden'}</button>` : ''}${p.status === 'offen' ? `<button data-rest="bezahlt">Als bezahlt markieren</button>${p.mahnstufe < 3 && tagStr(new Date(p.faellig_am)) < heute() ? `<button data-mahnen="${p.id}" data-sofort>${['Zahlungserinnerung', 'Mahnung', 'Letzte Mahnung'][p.mahnstufe]} erstellen</button>` : ''}<button data-rest="storniert">Stornieren</button>` : p.status === 'bezahlt' ? '<button data-rest="offen">Wieder offen</button>' : ''}</div>` : ''}</div></div>`;
  },

  system() {
    const reiter = ['mail', 'eingang', 'fints'].includes(V._stab) ? V._stab : 'mail';
    return `<h1>System</h1><p class="sub">Technische Verbindungen: Mailserver, Rechnungspostfach und Bankzugang.</p>
<div class="tabs">${[['mail', 'E-Mail'], ['eingang', 'Rechnungseingang'], ['fints', 'Bank (FinTS)']].map(([i, l]) => `<button data-stab="${i}" class="${reiter === i ? 'on' : ''}">${l}</button>`).join('')}</div>${konfFormular(reiter)}`;
  },

  einstellungen() {
    const reiter = ['terminarten', 'rechnungslauf', 'praxis', 'datev'].includes(V._etab) ? V._etab : 'terminarten';
    const REITER = [['terminarten', 'Terminarten & Beträge'], ['rechnungslauf', 'Rechnungslauf'], ['praxis', 'Praxis & Rechnung'], ['datev', 'DATEV']];
    const jeStunde = (a) => eur(Math.round(a.preis_cent / a.dauer_min * 60) / 100);
    return `<h1>Einstellungen</h1>
<div class="tabs">${REITER.map(([i, l]) => `<button data-etab="${i}" class="${reiter === i ? 'on' : ''}">${l}</button>`).join('')}</div>
${reiter === 'terminarten' ? `<div class="card"><table class="stack einzeilig"><thead><tr><th>Terminart</th><th class="n">Übliche Dauer</th><th class="n">Preis</th><th class="n">je Stunde</th><th class="n">Ausfall (&lt; 24 h)</th><th class="n">Nicht erschienen</th><th></th></tr></thead><tbody>${TA.map((a) => `<tr><td data-l="Terminart"><b>${esc(a.name)}</b></td><td class="n" data-l="Übliche Dauer">${a.dauer_min} min</td><td class="n" data-l="Preis">${eur(a.preis_cent / 100)}</td><td class="n sub" data-l="je Stunde">${jeStunde(a)}</td><td class="n" data-l="Ausfall">${eur(a.ausfall_cent / 100)}</td><td class="n" data-l="Nicht erschienen">${eur(a.unentschuldigt_cent / 100)}</td><td class="n"><button class="sm" data-terminart="${a.id}">Ändern</button>${TA.length > 1 ? ` <button class="sm" data-tartweg="${a.id}">Entfernen</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="7" class="sub">Noch keine Terminarten.</td></tr>'}</tbody></table>
<div class="row" style="margin-top:10px"><span class="sp"></span><button class="pri" data-terminart="0">Neue Terminart</button></div>
</div>`
: reiter === 'rechnungslauf' ? `<form class="card" id="avform" style="max-width:620px"><h2 style="margin-top:0">Monatlicher Rechnungslauf</h2><p>Am <b>3. jedes Monats um 06:00 Uhr</b> werden die Rechnungen für den Vormonat erstellt (nächster Lauf: ${datum(naechsterLauf())}).</p>
<label style="display:flex;gap:10px;align-items:flex-start;margin-top:12px"><input type="checkbox" name="autoversand" ${EIN.autoversand ? 'checked' : ''} style="width:auto;min-height:0;margin-top:3px"><span><b>Rechnungen automatisch per E-Mail versenden</b><br><span class="sub" style="margin:0">Direkt nach dem Lauf geht jede Rechnung mit dem Standardtext an die E-Mail-Adresse des Zahlers. Ausgeschaltet bleiben sie im Rechnungsausgang, bis du sie geprüft und gesendet hast.</span></span></label>
<p class="hint">Rechnungen ohne E-Mail-Adresse oder bei einem Versandfehler bleiben immer im Rechnungsausgang. Der Versand braucht einen eingerichteten Postausgang (System → E-Mail).</p>
<div class="row"><span class="sp"></span><button class="pri">Speichern</button></div></form>`
: konfFormular(reiter)}`;
  },

  eingang() {
    const a = E.auswahl;
    const tabs = `<div class="tabs">${ETABS.map(([t, l]) => `<button data-eintab="${t}" class="${E.tab === t ? 'on' : ''}">${l}${t === 'neu' && E.neu ? ` <span class="badge">${E.neu}</span>` : ''}</button>`).join('')}</div>`;
    const kopf = `<div class="row"><h1 style="margin:0">Belege</h1><span class="sp"></span><label class="btn" style="margin:0">Beleg hochladen<input type="file" accept="application/pdf,image/*" data-belegupload hidden></label><button class="pri" data-postfach ${E.abruf ? 'disabled' : ''}>${E.abruf ? 'Abruf läuft …' : 'Postfach abrufen'}</button></div>${tabs}`;
    if (E.tab === 'euer') {
      const x = E.euer, jahre = Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - i);
      return `${kopf}<div class="card" style="max-width:720px"><div class="row"><h2 style="margin:0">Ausgaben nach Kategorie</h2><span class="sp"></span><select data-euerjahr style="width:auto">${jahre.map((j) => `<option ${j === E.jahr ? 'selected' : ''}>${j}</option>`).join('')}</select></div>
${!x ? '<p class="sub">Lädt …</p>' : `<table class="stack"><thead><tr><th>Kategorie</th><th class="n">Posten</th><th class="n">Summe</th></tr></thead><tbody>${x.kategorien.filter((k) => k.anzahl).map((k) => `<tr><td>${esc(k.kategorie)}</td><td class="n">${k.anzahl}</td><td class="n">${eur(k.summe_cent / 100)}</td></tr>`).join('') || '<tr><td colspan="3" class="sub">Keine Ausgaben in diesem Jahr.</td></tr>'}<tr><td><b>Summe Betriebsausgaben</b></td><td></td><td class="n"><b>${eur(x.gesamt_cent / 100)}</b></td></tr></tbody></table>
${x.ohne_kategorie ? `<p class="hint"><b>${x.ohne_kategorie} Rechnung(en) ohne Posten</b> – bitte Kategorien zuordnen, sonst fehlen sie hier.</p>` : ''}
<p class="hint">Zugeordnet nach Zahlungsdatum (Abflussprinzip, § 11 EStG); ohne Zahlungsdatum nach Rechnungsdatum. Beträge brutto, da die Praxis umsatzsteuerfrei arbeitet und keine Vorsteuer abzieht. Anschaffungen über 800 € netto werden abgeschrieben – bitte mit der Steuerberatung abstimmen.</p>`}</div>`
+ (E.datev ? `<div class="card" style="max-width:720px;margin-top:14px"><div class="row"><h2 style="margin:0">DATEV-Export ${E.jahr}</h2><span class="sp"></span><a class="btn pri" href="/api/datev/${E.jahr}?datei" download>Buchungsstapel herunterladen</a></div>
<p>${E.datev.anzahl} Buchungen · Einnahmen ${eur(E.datev.einnahmen_cent / 100)} · Ausgaben ${eur(E.datev.ausgaben_cent / 100)}</p>
${E.datev.hinweise.length ? `<ul class="hint">${E.datev.hinweise.map((h) => `<li>${esc(h)}</li>`).join('')}</ul>` : ''}
<p class="hint">Datei im DATEV-Format (Buchungsstapel) für die Steuerberatung: bezahlte Rechnungen nach Zahlungsdatum, aufgeteilt auf Honorare, Ausfallhonorare und Mahngebühren; Ausgaben wie oben. Belege (PDFs) sind nicht enthalten. Konten unter <a href="#einstellungen">Einstellungen</a> → DATEV.</p></div>` : '');
    }
    const summe = a?.posten?.reduce((s, p) => s + p.betrag_cent, 0) ?? 0;
    return `${kopf}<div class="grid" style="grid-template-columns:${a ? 'minmax(0,3fr) minmax(320px,2fr)' : '1fr'}"><div class="card" style="min-width:0">
<table class="stack"><thead><tr><th>Eingang</th><th>Von</th><th>Worum</th><th class="n">Betrag</th></tr></thead><tbody>${E.liste.map((r) => `<tr data-beleg="${r.id}" style="cursor:pointer${a?.id === r.id ? ';background:var(--mainbg)' : ''}"><td>${datum(r.rechnungsdatum || r.empfangen_am)}${r.status === 'bezahlt' ? ' <span class="st" style="--c:var(--ok)">bezahlt</span>' : ''}</td><td><b>${esc(r.lieferant || r.mail_absender || 'Upload')}</b>${r.rechnungsnummer ? `<br><span class="sub">Nr. ${esc(r.rechnungsnummer)}</span>` : ''}</td><td>${esc(r.beschreibung || r.mail_betreff || r.dateiname)}${VST[r.verarbeitung] ? `<br><span class="sub">${VST[r.verarbeitung]}</span>` : ''}${r.kategorien.length ? `<br><span class="sub">${esc([...new Set(r.kategorien.map((k) => k.kategorie))].join(' · '))}</span>` : ''}</td><td class="n">${r.brutto_cent != null ? eur(r.brutto_cent / 100) : '—'}</td></tr>`).join('') || `<tr><td colspan="4" class="sub">${E.tab === 'neu' ? 'Keine neuen Belege im Postfach.' : 'Keine Belege in dieser Ansicht.'}</td></tr>`}</tbody></table></div>
${a ? `<div class="card" style="min-width:0"><div class="row"><h2 style="margin:0">${esc(a.lieferant || a.mail_absender || a.dateiname)}</h2><span class="sp"></span><button class="sm" data-belegzu title="Schließen">✕</button></div>
<p class="sub">${a.mail_betreff ? `Betreff: ${esc(a.mail_betreff)}<br>` : ''}Eingegangen ${new Date(a.empfangen_am).toLocaleString('de-DE')} · <a href="/api/eingang/${a.id}/datei" target="_blank">${esc(a.dateiname || 'Beleg')} öffnen</a></p>
${a.status === 'neu' || a.status === 'verworfen' ? `<p>Ist das eine Rechnung an die Praxis? Dann als Eingangsrechnung markieren – Gemini liest Betrag und Posten aus und ordnet sie den EÜR-Kategorien zu.</p><div class="row"><button class="pri" data-markieren="${a.id}">Als Eingangsrechnung markieren</button>${a.status === 'neu' ? '<button data-belegstatus="verworfen">Keine Rechnung (verwerfen)</button>' : ''}</div>` : `
${['wartet', 'laeuft'].includes(a.verarbeitung) ? '<p class="hint">Gemini liest die Rechnung aus …</p>' : a.verarbeitung_hinweis ? `<p class="hint">${esc(a.verarbeitung_hinweis)}</p>` : ''}
<form id="belegform" data-id="${a.id}"><div class="grid" style="gap:10px"><div><label for="b-l">Lieferant</label><input id="b-l" name="lieferant" value="${esc(a.lieferant || '')}"></div><div><label for="b-n">Rechnungsnummer</label><input id="b-n" name="rechnungsnummer" value="${esc(a.rechnungsnummer || '')}"></div></div>
<div class="grid" style="gap:10px"><div><label for="b-d">Rechnungsdatum</label><input id="b-d" name="rechnungsdatum" type="date" value="${a.rechnungsdatum ? tagStr(new Date(a.rechnungsdatum)) : ''}"></div><div><label for="b-b">Betrag brutto (€)</label><input id="b-b" name="brutto" type="number" step="0.01" value="${a.brutto_cent != null ? (a.brutto_cent / 100).toFixed(2) : ''}"></div></div>
<div class="grid" style="gap:10px"><div><label for="b-f">Fällig am</label><input id="b-f" name="faellig_am" type="date" value="${a.faellig_am ? tagStr(new Date(a.faellig_am)) : ''}"></div><div><label for="b-z">Bezahlt am</label><input id="b-z" name="bezahlt_am" type="date" value="${a.bezahlt_am ? tagStr(new Date(a.bezahlt_am)) : ''}"></div></div>
<label for="b-t">Beschreibung</label><input id="b-t" name="beschreibung" value="${esc(a.beschreibung || '')}">
<h3 style="margin:16px 0 4px">Posten und EÜR-Kategorien</h3>
<table><thead><tr><th>Beschreibung</th><th class="n">Brutto (€)</th><th>Kategorie</th><th></th></tr></thead><tbody id="postenliste">${a.posten.map(postenZeile).join('')}</tbody></table>
<div class="row" style="margin-top:6px"><button type="button" class="sm" data-postenneu>+ Posten</button><span class="sp"></span><span class="sub" style="margin:0">Summe ${eur(summe / 100)}${a.brutto_cent != null && summe !== a.brutto_cent ? ` <b style="color:var(--unent)">· Differenz ${eur((a.brutto_cent - summe) / 100)}</b>` : ''}</span></div>
<div class="row" style="margin-top:14px;flex-wrap:wrap"><button type="button" data-neuauslesen="${a.id}" title="Kopfdaten und Posten neu von Gemini auslesen lassen">Neu auslesen</button>${a.status === 'bezahlt' ? '<button type="button" data-belegstatus="eingang">Wieder offen</button>' : '<button type="button" data-belegstatus="bezahlt">Als bezahlt markieren</button>'}<button type="button" data-belegstatus="verworfen">Verwerfen</button><span class="sp"></span><button class="pri">Speichern</button></div></form>`}</div>` : ''}</div>`;
  },

  umsaetze() {
    const s = U.status, A = U.auswertung;
    // Monat aus dem Diagramm (oder der Tabelle) filtert Liste und Summen
    const tagU = (u) => tagStr(new Date(u.buchungsdatum));
    const liste = U.monat ? U.liste.filter((u) => monatVon(new Date(u.buchungsdatum)) === U.monat)
      : U.von ? U.liste.filter((u) => tagU(u) >= U.von && tagU(u) <= U.bis) : U.liste;
    const ein = liste.filter((u) => u.betrag_cent > 0).reduce((a, u) => a + u.betrag_cent, 0);
    const aus = liste.filter((u) => u.betrag_cent < 0).reduce((a, u) => a + u.betrag_cent, 0);
    return `<div class="row"><h1 style="margin:0">Umsätze</h1><span class="sp"></span><select data-filter style="width:auto">${[['', 'Alle'], ['eingang', 'Eingänge'], ['ausgang', 'Ausgänge']].map(([v, l]) => `<option value="${v}" ${U.nur === v ? 'selected' : ''}>${l}</option>`).join('')}</select><button data-abruf="voll" ${s.laeuft ? 'disabled' : ''} title="Alle Umsätze, die die Bank noch vorhält (meist 1–2 Jahre)">Alles abrufen</button><button class="pri" data-abruf ${s.laeuft ? 'disabled' : ''}>${s.laeuft ? 'Abruf läuft …' : 'Jetzt abrufen'}</button></div>
${s.freigabe_noetig ? '<p class="hint"><b>Freigabe nötig:</b> Bitte den Abruf in der S-pushTAN-App bestätigen (die Bank verlangt das etwa alle 90 Tage).</p>' : s.letzter_fehler ? `<p class="hint"><b>Letzter Abruf fehlgeschlagen:</b> ${esc(s.letzter_fehler)}</p>` : ''}
<div class="row"><div class="card" style="flex:1"><div class="sub" style="margin:0">Eingänge</div><b style="font-size:20px">${eur(ein / 100)}</b></div><div class="card" style="flex:1"><div class="sub" style="margin:0">Ausgänge</div><b style="font-size:20px">${eur(aus / 100)}</b></div>${s.saldo_cent != null ? `<div class="card" style="flex:1"><div class="sub" style="margin:0">Kontostand am ${datum(s.saldo_datum)}</div><b style="font-size:20px">${eur(s.saldo_cent / 100)}</b></div>` : ''}</div>
${A?.monate.length ? `<div class="grid" style="margin-bottom:14px"><div class="card"><h2>Kontoverlauf</h2>${A.verlauf?.length ? `<p class="sub" style="margin:0 0 6px">seit ${datum(s.erster_umsatz)}</p>${verlaufDiagramm(A.verlauf)}` : '<p class="sub">Der Kontostand kommt mit dem nächsten Abruf; dann wird der Verlauf rückwärts aus den Umsätzen berechnet.</p>'}</div>
<div class="card"><h2>Ein- und Ausgaben je Monat</h2><div class="legende"><span><i style="background:var(--ein)"></i>Einnahmen</span><span><i style="background:var(--ausg)"></i>Ausgaben</span></div>${monatsDiagramm(A.monate)}
<details style="margin-top:8px"><summary class="sub">Als Tabelle</summary><table class="stack"><thead><tr><th>Monat</th><th class="n">Einnahmen</th><th class="n">Ausgaben</th><th class="n">Überschuss</th></tr></thead><tbody>${[...A.monate].reverse().map((m) => `<tr class="click" data-umonat="${m.monat}"${U.monat === m.monat ? ' style="background:var(--mainbg)"' : ''}><td>${monatText(m.monat)}</td><td class="n">${eur(m.ein_cent / 100)}</td><td class="n">${eur(m.aus_cent / 100)}</td><td class="n">${eur((m.ein_cent - m.aus_cent) / 100)}</td></tr>`).join('')}</tbody></table></details></div></div>` : ''}
${U.monat || U.von ? `<div class="row" id="umsatzliste" style="margin:0 0 8px"><span class="st" style="--c:var(--main)">${U.monat ? monatText(U.monat) : `${datum(`${U.von}T12:00`)} – ${datum(`${U.bis}T12:00`)}`}</span><span class="sub" style="margin:0">${liste.length} Umsätze</span><button class="sm" data-umonat="">Filter aufheben ✕</button></div>` : '<div id="umsatzliste"></div>'}<table class="stack"><thead><tr><th>Datum</th><th>Auftraggeber / Empfänger</th><th>Verwendungszweck</th><th class="n">Betrag</th></tr></thead><tbody>
${liste.map((u) => `<tr><td>${datum(u.buchungsdatum)}${U.neuIds.has(u.id) ? ' <span class="badge">neu</span>' : ''}</td><td><b>${esc(u.gegen_name || u.buchungstext || '—')}</b>${u.gegen_iban ? `<br><span class="sub">${esc(u.gegen_iban)}</span>` : ''}</td><td>${esc(u.verwendungszweck)}</td><td class="n" style="color:${u.betrag_cent < 0 ? 'var(--unent)' : 'var(--ok)'};font-weight:600">${eur(u.betrag_cent / 100)}</td></tr>`).join('') || '<tr><td colspan="4" class="sub">Noch keine Umsätze abgerufen.</td></tr>'}</tbody></table>`;
  },
};

// Formular für Praxis- bzw. Systemeinstellungen (Gruppe aus konfigDienst.FELDER)
const konfFeld = (n, l) => `<div><label for="k-${n}">${l}</label><input id="k-${n}" name="${n}" value="${esc(KONF.werte[n])}"></div>`;
const praxisFormular = () => {
  const L = Object.fromEntries(KONF.felder.praxis);
  const gruppe = (titel, inhalt, sub = '') => `<fieldset style="border:0;padding:0;margin:0 0 22px"><h2 style="margin:0 0 4px">${titel}</h2>${sub ? `<p class="sub" style="margin:0 0 8px">${sub}</p>` : ''}${inhalt}</fieldset>`;
  const raster = (spalten, felder) => `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(${spalten}px,1fr));gap:0 14px">${felder.map(n => konfFeld(n, L[n])).join('')}</div>`;
  return gruppe('Praxis', `${raster(260, ['PRAXIS_NAME', 'PRAXIS_STEUERNR'])}<label for="k-PRAXIS_ANSCHRIFT">Anschrift (bis zu drei Zeilen)</label><textarea id="k-PRAXIS_ANSCHRIFT" name="PRAXIS_ANSCHRIFT" rows="3" style="resize:none">${esc(String(KONF.werte.PRAXIS_ANSCHRIFT ?? '').split('|').map(z => z.trim()).filter(Boolean).join('\n'))}</textarea>`, 'Erscheint im Kopf und Fuß jeder Rechnung und Mahnung.')
    + gruppe('Logo', `<div class="row">${KONF.logo ? `<img src="/api/konfiguration/logo?${S.logoV || 0}" alt="Logo" style="max-height:60px;max-width:180px">` : '<span class="sub">kein Logo – im Kopf steht der Praxisname</span>'}<span class="sp"></span><input id="k-logo" type="file" accept="image/png,image/jpeg" data-logo style="width:auto">${KONF.logo ? '<button type="button" data-logoweg>Entfernen</button>' : ''}</div>`, 'PNG oder JPEG, bis ca. 500 KB.')
    + gruppe('Bankverbindung', `${konfFeld('PRAXIS_IBAN', L.PRAXIS_IBAN)}${raster(200, ['PRAXIS_BIC', 'PRAXIS_BANK'])}`, 'Für die Zahlungsangaben und den Überweisungs-QR-Code.')
    + gruppe('Rechnungstext', konfFeld('PRAXIS_HINWEIS', L.PRAXIS_HINWEIS));
};
const konfFormular = (reiter) => !KONF ? '<p class="sub">Einstellungen werden geladen …</p>' : `<form class="card" id="konfform" style="max-width:720px">${reiter === 'praxis' ? praxisFormular() : [['praxis', 'Rechnungskopf und -fuß'], ['mail', 'Postausgang und Posteingang'], ['eingang', 'Rechnungspostfach und Gemini'], ['fints', 'Bankverbindung'], ['datev', 'DATEV-Export für die Steuerberatung']].filter(([g]) => g === reiter).map(([g, titel]) => `<h2 style="margin-top:0">${titel}</h2>${KONF.felder[g].map(([n, l, geheim]) => `<label for="k-${n}">${l}</label>${geheim
      ? `<input id="k-${n}" name="${n}" type="password" autocomplete="new-password" placeholder="${KONF.werte[n].gesetzt ? 'gespeichert – leer lassen, um es zu behalten' : 'nicht gesetzt'}">`
      : `<input id="k-${n}" name="${n}" value="${esc(KONF.werte[n])}"${KONF.vorgaben?.[n] ? ` placeholder="Vorschlag: ${KONF.vorgaben[n]}"` : ''}>`}`).join('')}${g === 'praxis' ? `<label for="k-logo">Logo im Rechnungskopf (PNG oder JPEG, bis ca. 500 KB)</label><div class="row">${KONF.logo ? `<img src="/api/konfiguration/logo?${S.logoV || 0}" alt="Logo" style="max-height:60px;max-width:180px">` : '<span class="sub">kein Logo – im Kopf steht der Praxisname</span>'}<span class="sp"></span><input id="k-logo" type="file" accept="image/png,image/jpeg" data-logo style="width:auto">${KONF.logo ? '<button type="button" data-logoweg>Entfernen</button>' : ''}</div>` : ''}${g === 'mail' ? '<div class="row" style="margin-top:10px"><button type="button" data-mailtest>Verbindung testen</button><span class="sub">erst speichern, dann testen</span></div>' : ''}${g === 'eingang' ? '<div class="row" style="margin-top:10px"><button type="button" data-postfachtest>Postfach-Verbindung testen</button><span class="sub">erst speichern, dann testen</span></div><p class="hint">Am besten eine eigene Adresse anlegen (z. B. rechnungen@…), an die Lieferanten ihre Rechnungen schicken. Ungelesene Mails mit PDF- oder Bildanhang erscheinen unter <a href="#eingang">Belege</a>. Den Gemini-API-Schlüssel (Google AI Studio) trägt man aus Sicherheitsgründen nur in der .env des Servers ein (GEMINI_API_KEY), nicht hier. Für die Praxis empfiehlt sich ein bezahlter Zugang, da Google Anfragen im kostenlosen Kontingent zur Verbesserung seiner Modelle verwenden darf.</p>' : ''}${g === 'datev' ? '<p class="hint">Leere Kontenfelder nehmen den Vorschlag des gewählten Kontenrahmens (nach dem Speichern aktualisiert). Die Vorschläge gehen von umsatzsteuerfreier Lerntherapie (§ 4 Nr. 21 UStG) aus – Kontenrahmen und Konten bitte mit der Steuerberatung abstimmen. Den Export gibt es unter <a href="#eingang">Belege</a> → EÜR-Übersicht.</p>' : ''}${g === 'fints' ? '<p class="hint">Den Abruf prüfst du auf der Seite <a href="#umsaetze">Umsätze</a> mit „Jetzt abrufen“. Bei der ersten Verbindung muss die Freigabe in der S-pushTAN-App bestätigt werden.</p>' : ''}`).join('')}
${['praxis', 'datev'].includes(reiter) ? '' : KONF.verschluesselung ? '<p class="hint">Passwörter und PIN werden verschlüsselt gespeichert und nie wieder angezeigt.</p>' : '<p class="hint"><b>Passwörter können noch nicht gespeichert werden:</b> GEHEIM_SCHLUESSEL in der .env des Servers setzen.</p>'}
<div class="row"><span class="sp"></span><button class="pri">Einstellungen speichern</button></div></form>`;

// ---------- Rahmen ----------
const NAV = [['uebersicht', 'Übersicht'], ['kalender', 'Kalender'], ['klienten', 'Klienten'], ['rechnungen', 'Rechnungen'], ['eingang', 'Belege'], ['umsaetze', 'Umsätze'], ['einstellungen', 'Einstellungen'], ['system', 'System']];
const nav = document.getElementById('nav'), main = document.getElementById('main'), pop = document.getElementById('pop'), dlg = document.getElementById('dlg');

function ansicht() {
  let v = location.hash.slice(1) || 'uebersicht';
  if (!V[v] || (v === 'akte' && !V._k)) v = 'uebersicht';
  return v;
}

function render() {
  const v = ansicht();
  nav.innerHTML = nav.firstElementChild.outerHTML + NAV.map(([i, l]) => `<a href="#${i}" class="${v === i || (v === 'akte' && i === 'klienten') ? 'on' : ''}">${l}${i === 'uebersicht' && offen().length ? `<span class="badge">${offen().length}</span>` : ''}${i === 'rechnungen' && R.mahn.length ? `<span class="badge" title="fällige Mahnungen">${R.mahn.length}</span>` : ''}${i === 'eingang' && E.neu ? `<span class="badge" title="neue Belege im Postfach">${E.neu}</span>` : ''}${i === 'umsaetze' && U.neu ? `<span class="badge" title="neue Umsätze">${U.neu}</span>` : ''}</a>`).join('');
  const fokus = document.activeElement?.matches?.('[data-suche]');
  main.innerHTML = (S.fehler ? `<div class="err">${esc(S.fehler)}</div>` : '') + V[v]();
  if (fokus) { const f = main.querySelector('[data-suche]'); f.focus(); f.setSelectionRange(f.value.length, f.value.length); }
}

// Führt eine Änderung aus, lädt neu und zeigt Fehler oben an
async function aktion(fn) {
  try { S.fehler = null; await fn(); await laden(); } catch (e) { S.fehler = e.message; }
  render();
}

const schliessen = () => pop.classList.remove('on');

// Eigene Hinweis- und Rückfrage-Popups (statt alert/confirm); liegen über einem offenen Dialog
function popup(text, { ja, nein, gefahr } = {}) {
  return new Promise((fertig) => {
    const el = document.createElement('div');
    el.className = 'pop on'; el.style.zIndex = 20;
    el.innerHTML = `<div class="dlg" role="alertdialog" aria-modal="true"><p style="margin:0 0 16px;white-space:pre-line">${esc(text)}</p><div class="row"><span class="sp"></span>${nein ? `<button data-p="0">${esc(nein)}</button>` : ''}<button class="pri" data-p="1" ${gefahr ? 'style="background:var(--unent);border-color:transparent"' : ''}>${esc(ja || 'OK')}</button></div></div>`;
    const zu = (w) => { el.remove(); removeEventListener('keydown', taste, true); fertig(w); };
    const taste = (e) => { if (e.key === 'Escape') { e.stopPropagation(); zu(false); } if (e.key === 'Enter') { e.preventDefault(); zu(true); } };
    el.addEventListener('click', (e) => { e.stopPropagation(); const b = e.target.closest('[data-p]'); if (b) zu(b.dataset.p === '1'); else if (e.target === el && nein) zu(false); });
    addEventListener('keydown', taste, true);
    document.body.append(el);
    el.querySelector('[data-p="1"]').focus();
  });
}
const hinweis = (text) => popup(text);
const frage = (text, ja = 'Ja', gefahr = true) => popup(text, { ja, nein: 'Abbrechen', gefahr });

// ---------- Dialoge ----------
function statusDialog(id) {
  const t = T.find((x) => x.id == id), k = kl(t.k), h = (t.beginn - new Date()) / 36e5, vor = h > 0;
  dlg.innerHTML = `<h2>${esc(k.name)}</h2><div class="sub" style="margin:0">${fd(t.d)}, ${ft(t.d)} · aktuell ${st(t.s)}</div>
<p class="hint">${h >= 24 ? 'Mehr als 24 h vorher: kostenfreie Absage möglich.' : vor ? `Noch ${Math.round(h)} h bis zum Termin – Absage gilt als <b>ausgefallen</b> und wird berechnet.` : 'Termin liegt in der Vergangenheit.'}</p>
<div class="row" style="align-items:end"><div><label for="t-real">Reale Dauer (Minuten)</label><input id="t-real" type="number" min="5" max="600" step="5" value="${t.dauer}" style="width:9em"></div><span class="sub" style="margin:0 0 10px" id="t-preis">${t.art ? `${esc(t.art)} · übliche Dauer ${t.geplant} min = ${eur(t.preis / 100)}, abweichende Dauer wird umgerechnet` : 'ohne Terminart: Stundensatz der Therapie'}</span></div>
<div class="opts">${[['stattgefunden', 'Hat stattgefunden – mit der oben eingetragenen Dauer', vor], ['abgesagt', 'Rechtzeitig abgesagt, nicht berechnet', h < 24], ['ausgefallen', 'Kurzfristig gemeldet, wird berechnet', false], ['unentschuldigt', 'Ohne Nachricht nicht erschienen, wird berechnet', vor], ['geplant', 'Zurück auf geplant', false]].map(([s, d, dis]) => `<button data-set="${s}" data-id="${id}" ${dis || s === t.s ? 'disabled' : ''} style="--c:var(${ST[s][1]})"><span class="st"></span><span><b>${ST[s][0]}</b><small>${d}</small></span></button>`).join('')}</div>
<form id="tdoku" data-id="${t.id}"><label for="td">Dokumentation</label><textarea id="td" rows="5" placeholder="Inhalte / Übungen, Beobachtungen, Hausaufgabe">${esc(t.txt)}</textarea>
<div class="row" style="margin-top:8px"><span class="sp"></span><button class="pri">Dokumentation speichern</button></div></form>
<div class="row"><button data-loesch="${t.id}">Termin löschen</button><span class="sp"></span><button data-close>Schließen</button></div>`;
  pop.classList.add('on');
}

function klientDialog(id) {
  const k = id ? kl(id).roh : { vorname: '', nachname: '', material_noetig: true };
  const f = (n, l, typ = 'text', extra = '') => `<label for="f-${n}">${l}</label><input id="f-${n}" name="${n}" type="${typ}" value="${esc(k[n] ?? '')}" ${extra}>`;
  dlg.innerHTML = `<h2>${id ? 'Klient bearbeiten' : 'Neuer Klient'}</h2><form id="kform" data-id="${id || ''}">
<div class="grid" style="gap:10px"><div>${f('vorname', 'Vorname', 'text', 'required')}</div><div>${f('nachname', 'Nachname', 'text', 'required')}</div></div>
<div class="grid" style="gap:10px"><div>${f('geburtsdatum', 'Geburtsdatum', 'date', `max="${heute()}"`)}</div><div>${f('schwerpunkt', 'Schwerpunkt')}</div></div>
${f('sorgeberechtigte', 'Erziehungsberechtigte (Kontakt)')}
<div class="grid" style="gap:10px"><div>${f('telefon', 'Telefon', 'tel')}</div><div>${f('email', 'E-Mail', 'email')}</div></div>
${f('aufnahme_datum', 'In Therapie seit', 'date')}
<label style="display:flex;gap:8px;align-items:center;margin-top:12px"><input type="checkbox" name="material_noetig" style="width:auto;min-height:0" ${k.material_noetig ? 'checked' : ''}> Material vor dem Ersttermin verschicken</label>
<div class="row" style="margin-top:14px"><span class="sp"></span><button type="button" data-close>Abbrechen</button><button class="pri">Speichern</button></div></form>`;
  if (k.aufnahme_datum) dlg.querySelector('[name=aufnahme_datum]').value = tagStr(new Date(k.aufnahme_datum));
  if (k.geburtsdatum) dlg.querySelector('[name=geburtsdatum]').value = tagStr(new Date(k.geburtsdatum));
  else if (k.geburtsjahr) dlg.querySelector('[name=geburtsdatum]').insertAdjacentHTML('afterend', `<span class="sub" style="margin:2px 0 0;display:block">bisher nur Jahrgang ${k.geburtsjahr} hinterlegt</span>`);
  pop.classList.add('on');
}

function terminDialog(klientId = null) {
  const start = plusTage(S.woche, Math.min(4, Math.max(0, (new Date().getDay() + 6) % 7)));
  start.setHours(14, 0, 0, 0);
  dlg.innerHTML = `<h2>Neuer Termin</h2><form id="tform"><label for="t-k">Klient</label><select id="t-k" required>${KL.filter((k) => k.aktiv).map((k) => `<option value="${k.id}" ${k.id === klientId ? 'selected' : ''}>${esc(k.name)}</option>`).join('')}</select>
<label for="t-th">Therapie</label><select id="t-th">${therapieOptionen(klientId ?? KL.find((k) => k.aktiv)?.id)}</select>
<label for="t-a">Terminart</label><select id="t-a">${TA.map((a, i) => `<option value="${a.id}" data-dauer="${a.dauer_min}" data-preis="${a.preis_cent}" ${i === 0 ? 'selected' : ''}>${esc(a.name)} – ${a.dauer_min} min, ${eur(a.preis_cent / 100)}</option>`).join('')}</select>
<div class="grid" style="gap:10px"><div><label for="t-d">Beginn</label><input id="t-d" type="datetime-local" required value="${lokal(start)}" step="900"></div><div><label for="t-m">Dauer (Minuten)</label><input id="t-m" type="number" min="5" max="600" step="5" required value="${TA[0]?.dauer_min ?? 60}"></div></div>
<p class="sub" id="t-preisinfo" style="margin:4px 0 0"></p>
<label for="t-w">Wiederholen</label><select id="t-w"><option value="1">einmalig</option><option value="4">wöchentlich, 4 Termine</option><option value="8">wöchentlich, 8 Termine</option><option value="12">wöchentlich, 12 Termine</option></select>
<div class="row" style="margin-top:14px"><span class="sp"></span><button type="button" data-close>Abbrechen</button><button class="pri">Anlegen</button></div></form>`;
  terminPreisInfo();
  pop.classList.add('on');
}

// Preis des neuen Termins: abweichende Dauer wird auf die übliche Dauer der Terminart umgerechnet
function terminPreisInfo() {
  const o = dlg.querySelector('#t-a')?.selectedOptions[0], m = +dlg.querySelector('#t-m')?.value, el = dlg.querySelector('#t-preisinfo');
  if (!o || !el) return;
  const d = +o.dataset.dauer, p = +o.dataset.preis;
  el.textContent = m >= 5 ? (m === d ? `Preis: ${eur(p / 100)}` : `Preis für ${m} min: ${eur(Math.round(p * m / d) / 100)} (übliche Dauer ${d} min = ${eur(p / 100)})`) : '';
}

function zahlerDialog(klientId, id) {
  const z = id ? ZA.find((x) => x.id === id) : { art: 'eltern', name: '', adresse: '', email: '', telefon: '' };
  const vorschlag = !id && !zahlerVon(klientId).length ? (kl(klientId).roh.sorgeberechtigte || '') : z.name;
  dlg.innerHTML = `<h2>${id ? 'Zahler bearbeiten' : 'Neuer Zahler'}</h2><form id="zform" data-id="${id || ''}" data-klient="${klientId}">
<label for="z-art">Art</label><select id="z-art" name="art">${Object.entries(ZART).map(([v, l]) => `<option value="${v}" ${z.art === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
<label for="z-name">Name</label><input id="z-name" name="name" required value="${esc(vorschlag)}" placeholder="z. B. Sandra Beispiel">
<label for="z-adr">Anschrift</label><textarea id="z-adr" name="adresse" rows="3" placeholder="Straße Nr.&#10;PLZ Ort">${esc(z.adresse || '')}</textarea>
<div class="grid" style="gap:10px"><div><label for="z-mail">E-Mail (Rechnungsversand)</label><input id="z-mail" name="email" type="email" value="${esc(z.email || '')}"></div><div><label for="z-tel">Telefon</label><input id="z-tel" name="telefon" type="tel" value="${esc(z.telefon || '')}"></div></div>
<div class="row" style="margin-top:14px">${id ? `<button type="button" data-zloesch="${id}">Löschen</button>` : ''}<span class="sp"></span><button type="button" data-close>Abbrechen</button><button class="pri">Speichern</button></div></form>`;
  pop.classList.add('on');
}

function therapieDialog(klientId, id) {
  const t = id ? TH.find((x) => x.id === id) : { bezeichnung: '', zahler_id: zahlerVon(klientId)[0]?.id, aktiv: true };
  dlg.innerHTML = `<h2>${id ? 'Therapie bearbeiten' : 'Neue Therapie'}</h2><form id="thform" data-id="${id || ''}" data-klient="${klientId}">
<label for="th-b">Therapieart</label><input id="th-b" name="bezeichnung" required list="th-arten" value="${esc(t.bezeichnung)}" placeholder="z. B. LRS-Therapie"><datalist id="th-arten">${['LRS-Therapie', 'Dyskalkulie-Therapie', 'Lerntherapie', 'Konzentrationstraining'].map((x) => `<option value="${x}">`).join('')}</datalist>
<label for="th-z">Zahler</label><select id="th-z" name="zahler_id" required>${zahlerVon(klientId).map((z) => `<option value="${z.id}" ${z.id === t.zahler_id ? 'selected' : ''}>${esc(z.name)} (${esc(ZART[z.art] ?? z.art)})</option>`).join('')}</select>
${SATZ.some(([f]) => t[f] != null) ? `<fieldset style="border:1px solid var(--line);border-radius:8px;margin-top:12px;padding:4px 12px 12px"><legend class="sub" style="margin:0;padding:0 4px">Eigene Beträge – gelten nur noch für ältere Termine ohne Terminart (leer = Standard)</legend>
<div class="grid" style="gap:10px;grid-template-columns:repeat(auto-fit,minmax(150px,1fr))">${SATZ.map(([f, l]) => `<div><label for="th-${f}">${l}</label><input id="th-${f}" name="${f}" type="number" step="0.01" min="0" value="${t[f] == null ? '' : (t[f] / 100).toFixed(2)}" placeholder="${(EIN[f] / 100).toFixed(2).replace('.', ',')} € (Standard)"></div>`).join('')}</div></fieldset>` : ''}
${id ? `<label style="display:flex;gap:8px;align-items:center;margin-top:12px"><input type="checkbox" name="aktiv" style="width:auto;min-height:0" ${t.aktiv ? 'checked' : ''}> Therapie läuft (abwählen, wenn sie beendet ist)</label>` : ''}
<div class="row" style="margin-top:14px"><span class="sp"></span><button type="button" data-close>Abbrechen</button><button class="pri">Speichern</button></div></form>`;
  pop.classList.add('on');
}

function terminartDialog(id) {
  const a = id ? TA.find((x) => x.id === id) : { name: '', dauer_min: 60, preis_cent: EIN.stundensatz_cent, ausfall_cent: EIN.ausfall_cent, unentschuldigt_cent: EIN.unentschuldigt_cent };
  const feld = (n, l, v) => `<div><label for="ta-${n}">${l} (€)</label><input id="ta-${n}" type="number" min="0" step="0.01" required value="${(v / 100).toFixed(2)}"></div>`;
  dlg.innerHTML = `<h2>${id ? 'Terminart ändern' : 'Neue Terminart'}</h2><form id="taform" data-id="${id || ''}">
<label for="ta-n">Name</label><input id="ta-n" required value="${esc(a.name)}" placeholder="z. B. Elterngespräch">
<div class="grid" style="gap:10px"><div><label for="ta-d">Übliche Dauer (Minuten)</label><input id="ta-d" type="number" min="5" max="600" step="5" required value="${a.dauer_min}"></div>${feld('p', 'Preis für die übliche Dauer', a.preis_cent)}</div>
<div class="grid" style="gap:10px">${feld('a', 'Ausfall (&lt; 24 h abgesagt)', a.ausfall_cent)}${feld('u', 'Nicht erschienen', a.unentschuldigt_cent)}</div>
<p class="hint" id="ta-info"></p>
<div class="row" style="margin-top:14px"><span class="sp"></span><button type="button" data-close>Abbrechen</button><button class="pri">Speichern</button></div></form>`;
  terminartInfo();
  pop.classList.add('on');
}
// Umrechnungsbeispiel im Terminart-Dialog
function terminartInfo() {
  const el = dlg.querySelector('#ta-info'); if (!el) return;
  const d = +dlg.querySelector('#ta-d').value, p = centAusEingabe(dlg.querySelector('#ta-p').value);
  el.textContent = d >= 5 && p != null ? `Abweichende Dauer wird umgerechnet: ${[...new Set([45, 60, 90, d])].sort((x, y) => x - y).map((m) => `${m} min = ${eur(Math.round(p * m / d) / 100)}`).join(' · ')}` : '';
}

function materialDialog(id) {
  dlg.innerHTML = `<h2>Material versandt</h2><p>${esc(kl(id).name)} – wie wurde das Material verschickt?</p><div class="row">${['E-Mail', 'Post', 'persönlich'].map((w) => `<button data-material="${id}" data-wie="${w}">${w}</button>`).join('')}<span class="sp"></span><button data-close>Abbrechen</button></div>`;
  pop.classList.add('on');
}

async function mailDialog(pfad) {
  const e = await api(pfad + '/versand');
  dlg.innerHTML = `<h2>Per E-Mail senden</h2>${e.eingerichtet ? '' : '<p class="hint"><b>Noch nicht eingerichtet:</b> SMTP-Zugang (SMTP_HOST usw.) in der .env eintragen.</p>'}<form id="mform" data-pfad="${esc(pfad)}">
<label for="m-an">An</label><input id="m-an" type="email" required value="${esc(e.an)}" placeholder="E-Mail der Erziehungsberechtigten">
<label for="m-b">Betreff</label><input id="m-b" required value="${esc(e.betreff)}">
<label for="m-t">Text</label><textarea id="m-t" rows="10" required>${esc(e.text)}</textarea>
<p class="sub">Das PDF wird als Anhang mitgeschickt.</p>
<div class="row" style="margin-top:14px"><span class="sp"></span><button type="button" data-close>Abbrechen</button><button class="pri" ${e.eingerichtet ? '' : 'disabled'}>Senden</button></div></form>`;
  pop.classList.add('on');
}

// ---------- Termine im Kalender ziehen ----------
// Raster: 56 px je Stunde, Schritte von 15 Minuten (14 px). Verschieben auch auf einen anderen Tag der Woche.
const SCHRITT = 14, MIN_H = 14;
let kz = null, nachZug = false;
const rasterZeit = (col, top) => { const min = Math.round(top / SCHRITT) * 15 + +col.dataset.h0 * 60; const d = new Date(`${col.dataset.tag}T00:00`); d.setMinutes(min); return d; };
function kalZeitZeigen() {
  const b = rasterZeit(kz.col, kz.top), e = new Date(+b + (kz.hoehe / SCHRITT) * 15 * 60000);
  kz.el.querySelector('.zeit').textContent = `${ft(b)} – ${ft(e)}`;
  return [b, e];
}
document.addEventListener('pointerdown', (e) => {
  const el = e.target.closest?.('.cal .ev.ziehbar');
  if (!el || e.button !== 0) return;
  const col = el.closest('.col'), top = parseFloat(el.style.top) - 2, hoehe = parseFloat(el.style.height) + 4;
  kz = { el, col, start: { x: e.clientX, y: e.clientY }, top0: top, hoehe0: hoehe, top, hoehe, art: e.target.dataset.griff || 'schieben', bewegt: false, id: +el.dataset.term };
  el.setPointerCapture?.(e.pointerId);
});
document.addEventListener('pointermove', (e) => {
  if (!kz) return;
  const dx = e.clientX - kz.start.x, dy = e.clientY - kz.start.y;
  if (!kz.bewegt && Math.hypot(dx, dy) < 4) return;
  kz.bewegt = true; kz.el.classList.add('zieht');
  const max = kz.col.clientHeight, snap = (v) => Math.round(v / SCHRITT) * SCHRITT;
  if (kz.art === 'schieben') {
    const ziel = document.elementsFromPoint(e.clientX, e.clientY).find((x) => x.classList?.contains('col'));
    if (ziel && ziel !== kz.col) { ziel.append(kz.el); kz.col = ziel; }
    kz.top = Math.min(max - kz.hoehe, Math.max(0, snap(kz.top0 + dy)));
  } else if (kz.art === 'oben') {
    const unten = kz.top0 + kz.hoehe0;
    kz.top = Math.min(unten - MIN_H, Math.max(0, snap(kz.top0 + dy))); kz.hoehe = unten - kz.top;
  } else kz.hoehe = Math.min(max - kz.top, Math.max(MIN_H, snap(kz.hoehe0 + dy)));
  kz.el.style.top = `${kz.top + 2}px`; kz.el.style.height = `${kz.hoehe - 4}px`;
  kalZeitZeigen();
});
document.addEventListener('pointerup', () => {
  if (!kz) return;
  const z = kz; kz = null;
  z.el.classList.remove('zieht');
  if (!z.bewegt) return;
  nachZug = true; setTimeout(() => { nachZug = false; }, 0); // der folgende Klick öffnet keinen Dialog
  kz = z; const [beginn, ende] = kalZeitZeigen(); kz = null;
  aktion(() => api(`/termine/${z.id}`, { methode: 'PUT', daten: { beginn: beginn.toISOString(), ende: ende.toISOString() } }));
});
addEventListener('keydown', (e) => { if (e.key === 'Escape' && kz) { kz = null; render(); } }); // Ziehen abbrechen

// ---------- Bereich im Kontoverlauf markieren ----------
// Maus bzw. Finger ziehen: markierter Zeitraum filtert die Umsatzliste (ersetzt einen Monatsfilter)
let zug = null;
const svgX = (svg, e) => { const p = svg.createSVGPoint(); p.x = e.clientX; p.y = e.clientY; return p.matrixTransform(svg.getScreenCTM().inverse()).x; };
document.addEventListener('pointerdown', (e) => {
  const svg = e.target.closest?.('svg.verlauf');
  if (!svg || e.button !== 0) return;
  const d = svg.dataset, x = Math.min(+d.x1, Math.max(+d.x0, svgX(svg, e)));
  zug = { svg, start: x, x, d };
  svg.setPointerCapture?.(e.pointerId);
  e.preventDefault();
});
document.addEventListener('pointermove', (e) => {
  if (!zug) return;
  zug.x = Math.min(+zug.d.x1, Math.max(+zug.d.x0, svgX(zug.svg, e)));
  const r = zug.svg.querySelector('.ziehen');
  r.setAttribute('x', Math.min(zug.start, zug.x)); r.setAttribute('width', Math.abs(zug.x - zug.start));
});
document.addEventListener('pointerup', () => {
  if (!zug) return;
  const { start, x, d } = zug; zug = null;
  if (Math.abs(x - start) < 4) return; // nur ein Klick: kein Bereich
  const zeit = (v) => new Date(+d.t0 + (+d.t1 - +d.t0) * (v - +d.x0) / (+d.x1 - +d.x0));
  U.von = tagStr(zeit(Math.min(start, x))); U.bis = tagStr(zeit(Math.max(start, x))); U.monat = '';
  render();
  document.getElementById('umsatzliste')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
});

// ---------- Ereignisse ----------
document.addEventListener('click', (e) => {
  if (e.target === pop) return schliessen();
  const b = e.target.closest('[data-archive],[data-term],[data-set],[data-close],[data-send],[data-material],[data-go],[data-kl],[data-tab],[data-edit],[data-archive],[data-arch],[data-neutermin],[data-umonat],[data-zschritt],[data-zsetzen],[data-sammelversand],[data-vf],[data-woche],[data-loesch],[data-abruf],[data-re],[data-rest],[data-lauf],[data-abgleich],[data-mahnen],[data-mail],[data-zahler],[data-therapie],[data-zloesch],[data-mailtest],[data-refilter],[data-logoweg],[data-etab],[data-stab],[data-terminart],[data-tartweg],[data-eintab],[data-postfachtest],[data-beleg],[data-belegzu],[data-postfach],[data-markieren],[data-belegstatus],[data-neuauslesen],[data-postenneu],[data-postenweg]');
  if (!b) return;
  const d = b.dataset;
  if (d.term) { if (nachZug) return; return statusDialog(d.term); }
  if (d.set) {
    const daten = { status: d.set };
    const t = T.find((x) => x.id == d.id), min = +dlg.querySelector('#t-real')?.value;
    if (d.set === 'stattgefunden' && min >= 5 && min !== t.dauer) daten.ende = new Date(+t.beginn + min * 60000).toISOString(); // reale Dauer
    schliessen(); return aktion(() => api(`/termine/${d.id}`, { methode: 'PUT', daten }));
  }
  if ('close' in d) return schliessen();
  if (d.send) return materialDialog(d.send);
  if (d.material) { schliessen(); return aktion(() => api(`/klienten/${d.material}`, { methode: 'PUT', daten: { material_versandt_am: heute(), material_versand_art: d.wie } })); }
  if (d.loesch) return frage('Termin wirklich löschen?', 'Löschen').then((ok) => { if (!ok) return; schliessen(); return aktion(() => api(`/termine/${d.loesch}`, { methode: 'DELETE' })); });
  if (d.refilter) { R.filter = d.refilter; R.auswahl = null; return render(); }
  if ('logoweg' in d) return aktion(async () => { KONF = await api('/konfiguration/logo', { methode: 'DELETE' }); });
  if (d.go) { if (d.ansicht) { R.filter = d.ansicht; R.auswahl = null; } location.hash = d.go; return; }
  if (d.kl) { V._k = +d.kl; V._vf = 'alle'; location.hash = 'akte'; return render(); }
  if (d.tab) { V._tab = d.tab; return render(); }
  if (d.etab) { V._etab = d.etab; return render(); }
  if (d.stab) { V._stab = d.stab; return render(); }
  if (d.terminart !== undefined) return terminartDialog(+d.terminart);
  if (d.tartweg) return frage(`Terminart „${TA.find((a) => a.id == d.tartweg)?.name}“ entfernen?\nBestehende Termine behalten Dauer und Preis.`, 'Entfernen').then((ok) => ok && aktion(() => api(`/terminarten/${d.tartweg}`, { methode: 'DELETE' })));
  if ('postfachtest' in d) {
    b.disabled = true; b.textContent = 'Prüfe …';
    return api('/eingang/postfach-test', { methode: 'POST' }).then((r) => hinweis(`Anmeldung am Rechnungspostfach erfolgreich.\n${r.ungelesen} ungelesene Mail(s) im Ordner.`), (x) => hinweis(x.message))
      .finally(() => { b.disabled = false; b.textContent = 'Postfach-Verbindung testen'; });
  }
  if (d.eintab) { E.tab = d.eintab; E.auswahl = null; return ladeEingang().then(render); }
  if (d.beleg) return api(`/eingang/${d.beleg}`).then((r) => { E.auswahl = r; render(); eingangBeobachten(); });
  if ('belegzu' in d) { E.auswahl = null; return render(); }
  if ('postfach' in d) { E.abruf = true; render(); return api('/eingang/abruf', { methode: 'POST' }).then(({ neu }) => { hinweis(neu ? `${neu} neue(r) Beleg(e) übernommen.` : 'Keine neuen Belege im Postfach.'); }, (x) => hinweis(x.message)).finally(async () => { E.abruf = false; await ladeEingang(); render(); }); }
  if (d.markieren) return aktion(async () => { await api(`/eingang/${d.markieren}/markieren`, { methode: 'POST' }); E.tab = 'eingang'; await ladeEingang(); eingangBeobachten(); });
  if (d.neuauslesen) return frage('Kopfdaten und Posten neu von Gemini auslesen lassen?\nVon Hand eingetragene Posten gehen verloren.', 'Neu auslesen', false).then((ok) => ok && aktion(async () => { E.auswahl = await api(`/eingang/${d.neuauslesen}/auslesen`, { methode: 'POST' }); await ladeEingang(); eingangBeobachten(); }));
  if (d.belegstatus) return aktion(async () => { E.auswahl = await api(`/eingang/${E.auswahl.id}`, { methode: 'PUT', daten: { status: d.belegstatus } }); if (d.belegstatus === 'verworfen') E.auswahl = null; await ladeEingang(); });
  if ('postenneu' in d) { document.getElementById('postenliste').insertAdjacentHTML('beforeend', postenZeile()); return; }
  if ('postenweg' in d) { b.closest('tr').remove(); return; }
  if (d.edit !== undefined) return klientDialog(+d.edit);
  if (d.archive) {
    e.stopPropagation();
    const k = kl(d.archive), geplant = T.filter((t) => t.k === k.id && t.s === 'geplant' && t.beginn >= new Date()).length;
    const text = k.aktiv ? `${k.name} archivieren?\nDer Klient erscheint dann nur noch im Archiv und kann jederzeit reaktiviert werden.${geplant ? `\n\nAchtung: Es gibt noch ${geplant} geplante(n) Termin(e).` : ''}` : `${k.name} wieder aktivieren?`;
    return frage(text, k.aktiv ? 'Archivieren' : 'Reaktivieren', false).then((ok) => ok && aktion(() => api(`/klienten/${k.id}`, { methode: 'PUT', daten: { aktiv: !k.aktiv } })));
  }
  if ('arch' in d) { V._arch = d.arch === '1'; return render(); }
  if ('neutermin' in d) return terminDialog(+d.neutermin || null);
  if (d.vf) { V._vf = d.vf; return render(); }
  if (d.woche !== undefined) { S.woche = +d.woche ? plusTage(S.woche, 7 * +d.woche) : montag(new Date()); return render(); }
  if ('sammelversand' in d) {
    const ids = reImMonat().filter(REFILTER[0][2]).map((r) => r.id).filter((id) => R.auswahlIds.has(id));
    return frage(`${ids.length} Rechnung${ids.length === 1 ? '' : 'en'} jetzt per E-Mail an die Zahler senden?`, 'Senden', false).then((ok) => ok && aktion(async () => {
      b.disabled = true; b.textContent = 'Wird gesendet …';
      const { gesendet, fehler } = await api('/rechnungen/versand', { methode: 'POST', daten: { ids } });
      R.auswahlIds.clear();
      hinweis(`${gesendet.length} Rechnung${gesendet.length === 1 ? '' : 'en'} gesendet.${fehler.length ? `\n\nNicht gesendet:\n${fehler.map((f) => `${f.nummer}: ${f.fehler}`).join('\n')}` : ''}`);
    }));
  }
  if (d.zschritt) { R.zeitraum = zeitraumSchritt(R.zeitraum, +d.zschritt); R.auswahl = null; R.auswahlIds.clear(); return render(); }
  if (d.zsetzen !== undefined) { R.zeitraum = d.zsetzen; R.auswahl = null; R.auswahlIds.clear(); return render(); }
  if (d.umonat !== undefined) { U.von = U.bis = ''; U.monat = U.monat === d.umonat ? '' : d.umonat; render(); if (U.monat) document.getElementById('umsatzliste')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
  if (d.re) {
    if (e.target.matches('[data-ausw]')) return;
  }
  if (d.re) return api(`/rechnungen/${d.re}`).then((r) => { R.auswahl = r; render(); });
  if (d.rest) {
    const id = R.auswahl.id;
    return (d.rest === 'storniert' ? frage('Rechnung stornieren?\nDie Termine werden wieder abrechenbar.', 'Stornieren') : Promise.resolve(true)).then((ok) => ok && aktion(async () => { await api(`/rechnungen/${id}/status`, { methode: 'PUT', daten: { status: d.rest } }); R.auswahl = await api(`/rechnungen/${id}`); await ladeVorschau(); }));
  }
  if (d.zahler !== undefined) return zahlerDialog(+d.klient, +d.zahler);
  if (d.therapie !== undefined) return therapieDialog(+d.klient, +d.therapie);
  if (d.zloesch) return frage('Zahler löschen?', 'Löschen').then((ok) => { if (!ok) return; schliessen(); return aktion(() => api(`/zahler/${d.zloesch}`, { methode: 'DELETE' })); });
  if ('mailtest' in d) {
    b.disabled = true; b.textContent = 'Prüfe …';
    return api('/konfiguration/mail-test', { methode: 'POST' }).then(() => hinweis('Anmeldung am Mailserver erfolgreich.'), (x) => hinweis(x.message))
      .finally(() => { b.disabled = false; b.textContent = 'Verbindung testen'; });
  }
  if (d.mail) { e.preventDefault(); return mailDialog(d.mail).catch((x) => { S.fehler = x.message; render(); }); }
  if (d.mahnen) return aktion(async () => {
    const m = await api(`/rechnungen/${d.mahnen}/mahnung`, { methode: 'POST', daten: { erzwingen: 'sofort' in d } });
    R.auswahl = await api(`/rechnungen/${d.mahnen}`); await ladeVorschau();
    window.open(`/api/rechnungen/mahnungen/${m.id}/pdf`, '_blank');
  });
  if ('lauf' in d) return aktion(async () => { const { erstellt } = await api('/rechnungen/lauf', { methode: 'POST', daten: { monat: R.monat } }); if (erstellt[0]) R.auswahl = await api(`/rechnungen/${erstellt[0].id}`); await ladeVorschau(); });
  if ('abgleich' in d) return aktion(async () => { const { bezahlt } = await api('/rechnungen/abgleich', { methode: 'POST' }); if (!bezahlt.length) hinweis('Keine neuen Zahlungen gefunden.'); else hinweis(`${bezahlt.length} Rechnung(en) als bezahlt markiert.`); });
  if ('abruf' in d) { api('/umsaetze/abruf' + (d.abruf === 'voll' ? '?voll=1' : ''), { methode: 'POST' }).then(async () => { await ladeUmsatzStatus(); render(); }); }
});

document.addEventListener('input', (e) => {
  if (e.target.id === 't-m') return terminPreisInfo();
  if (['ta-d', 'ta-p'].includes(e.target.id)) return terminartInfo();
  if (e.target.matches('[data-suche]')) { S.suche = e.target.value; render(); }
});

document.addEventListener('change', async (e) => {
  if (e.target.matches('[data-ausw]')) { const id = +e.target.dataset.ausw; if (e.target.checked) R.auswahlIds.add(id); else R.auswahlIds.delete(id); return render(); }
  if (e.target.matches('[data-alleaus]')) { const liste = reImMonat().filter(REFILTER[0][2]); if (e.target.checked) liste.forEach((r) => R.auswahlIds.add(r.id)); else R.auswahlIds.clear(); return render(); }
  if (e.target.matches('[data-filter]')) { U.nur = e.target.value; await ladeUmsaetze(); render(); }
  if (e.target.matches('[data-logo]') && e.target.files[0]) {
    const daten = await new Promise((ok, fehler) => { const l = new FileReader(); l.onload = () => ok(l.result); l.onerror = fehler; l.readAsDataURL(e.target.files[0]); });
    await aktion(async () => { KONF = await api('/konfiguration/logo', { methode: 'PUT', daten: { daten } }); S.logoV = Date.now(); });
  }
  if (e.target.matches('[data-belegupload]') && e.target.files[0]) {
    const datei = e.target.files[0];
    const daten = await new Promise((ok, fehler) => { const l = new FileReader(); l.onload = () => ok(l.result); l.onerror = fehler; l.readAsDataURL(datei); });
    return aktion(async () => { const r = await api('/eingang/upload', { methode: 'POST', daten: { dateiname: datei.name, daten } }); E.tab = 'eingang'; E.auswahl = { id: r.id }; await ladeEingang(); eingangBeobachten(); });
  }
  if (e.target.matches('[data-euerjahr]')) { E.jahr = +e.target.value; await ladeEingang(); return render(); }
  if (e.target.matches('[data-zeitraum]')) { R.zeitraum = e.target.value; R.auswahl = null; R.auswahlIds.clear(); return render(); }
  if (e.target.matches('[data-remonat]')) { R.monat = e.target.value; await ladeVorschau(); render(); }
  if (e.target.id === 't-a') { dlg.querySelector('#t-m').value = e.target.selectedOptions[0].dataset.dauer; terminPreisInfo(); return; }
  if (e.target.id === 't-real') return;
  if (e.target.id === 't-k') { dlg.querySelector('#t-th').innerHTML = therapieOptionen(+e.target.value); return; }
});

document.addEventListener('submit', (e) => {
  e.preventDefault();
  const f = e.target;
  if (f.id === 'kform') {
    const w = Object.fromEntries(new FormData(f));
    const daten = {
      vorname: w.vorname.trim(), nachname: w.nachname.trim(),
      geburtsdatum: w.geburtsdatum || null,
      schwerpunkt: w.schwerpunkt || null, sorgeberechtigte: w.sorgeberechtigte || null,
      telefon: w.telefon || null, email: w.email || null,
      aufnahme_datum: w.aufnahme_datum || null, material_noetig: 'material_noetig' in w,
    };
    schliessen();
    // Neuer Klient: direkt in die Akte (Stammdaten), um Zahler und Therapie anzulegen
    return aktion(async () => {
      if (f.dataset.id) return api(`/klienten/${f.dataset.id}`, { methode: 'PUT', daten });
      const neu = await api('/klienten', { methode: 'POST', daten });
      V._k = neu.id; location.hash = 'akte';
    });
  }
  if (f.id === 'zform') {
    const w = Object.fromEntries(new FormData(f));
    const daten = { art: w.art, name: w.name.trim(), adresse: w.adresse.trim() || null, email: w.email.trim() || null, telefon: w.telefon.trim() || null };
    schliessen();
    return aktion(() => (f.dataset.id ? api(`/zahler/${f.dataset.id}`, { methode: 'PUT', daten }) : api('/zahler', { methode: 'POST', daten: { ...daten, klient_id: +f.dataset.klient } })));
  }
  if (f.id === 'thform') {
    const w = Object.fromEntries(new FormData(f));
    const daten = { bezeichnung: w.bezeichnung.trim(), zahler_id: +w.zahler_id, ...Object.fromEntries(SATZ.map(([n]) => [n, centAusEingabe(w[n])])) };
    if (f.dataset.id) daten.aktiv = 'aktiv' in w;
    schliessen();
    return aktion(() => (f.dataset.id ? api(`/therapien/${f.dataset.id}`, { methode: 'PUT', daten }) : api('/therapien', { methode: 'POST', daten: { ...daten, klient_id: +f.dataset.klient } })));
  }
  if (f.id === 'konfform') {
    const daten = {};
    for (const el of f.querySelectorAll('[name]')) {
      if (el.type === 'password') { if (el.value) daten[el.name] = el.value; }
      else if (el.tagName === 'TEXTAREA') daten[el.name] = el.value.split(/\r?\n/).map(z => z.trim()).filter(Boolean).slice(0, 3).join(' | ');
      else daten[el.name] = el.value;
    }
    return aktion(async () => { KONF = await api('/konfiguration', { methode: 'PUT', daten }); hinweis('Einstellungen gespeichert.'); });
  }
  if (f.id === 'belegform') {
    const w = Object.fromEntries(new FormData(f));
    const kopf = { lieferant: w.lieferant.trim(), rechnungsnummer: w.rechnungsnummer.trim(), rechnungsdatum: w.rechnungsdatum, faellig_am: w.faellig_am, bezahlt_am: w.bezahlt_am, beschreibung: w.beschreibung.trim(), brutto_cent: centAusEingabe(w.brutto) };
    const posten = [...f.querySelectorAll('[data-posten]')].map((z) => ({ beschreibung: z.querySelector('[data-p=beschreibung]').value.trim(), betrag_cent: centAusEingabe(z.querySelector('[data-p=betrag]').value) ?? 0, kategorie: z.querySelector('[data-p=kategorie]').value }));
    return aktion(async () => {
      await api(`/eingang/${f.dataset.id}`, { methode: 'PUT', daten: kopf });
      E.auswahl = await api(`/eingang/${f.dataset.id}/posten`, { methode: 'PUT', daten: { posten } });
      await ladeEingang(); hinweis('Gespeichert.');
    });
  }
  if (f.id === 'taform') {
    const daten = { name: f.querySelector('#ta-n').value.trim(), dauer_min: +f.querySelector('#ta-d').value, preis_cent: centAusEingabe(f.querySelector('#ta-p').value) ?? 0, ausfall_cent: centAusEingabe(f.querySelector('#ta-a').value) ?? 0, unentschuldigt_cent: centAusEingabe(f.querySelector('#ta-u').value) ?? 0 };
    schliessen();
    return aktion(() => (f.dataset.id ? api(`/terminarten/${f.dataset.id}`, { methode: 'PUT', daten }) : api('/terminarten', { methode: 'POST', daten })));
  }
  if (f.id === 'avform') {
    const autoversand = f.querySelector('[name=autoversand]').checked;
    return aktion(async () => { await api('/einstellungen', { methode: 'PUT', daten: { autoversand } }); hinweis(autoversand ? 'Automatischer Versand ist eingeschaltet.' : 'Rechnungen bleiben zur Prüfung im Rechnungsausgang.'); });
  }
  if (f.id === 'eform') {
    const daten = Object.fromEntries(SATZ.map(([n]) => [n, centAusEingabe(f.querySelector(`#e-${n}`).value) ?? 0]));
    return aktion(() => api('/einstellungen', { methode: 'PUT', daten }));
  }
  if (f.id === 'mform') {
    const daten = { an: f.querySelector('#m-an').value.trim(), betreff: f.querySelector('#m-b').value, text: f.querySelector('#m-t').value };
    const knopf = f.querySelector('.pri'); knopf.disabled = true; knopf.textContent = 'Wird gesendet …';
    return api(f.dataset.pfad + '/versand', { methode: 'POST', daten }).then(async () => {
      schliessen();
      await aktion(async () => { if (R.auswahl) R.auswahl = await api(`/rechnungen/${R.auswahl.id}`); });
    }).catch((x) => { knopf.disabled = false; knopf.textContent = 'Senden'; hinweis(x.message); });
  }
  if (f.id === 'tform') {
    const k = +f.querySelector('#t-k').value, beginn = new Date(f.querySelector('#t-d').value);
    const dauer = +f.querySelector('#t-m').value, anzahl = +f.querySelector('#t-w').value, th = +f.querySelector('#t-th').value, art = +f.querySelector('#t-a').value || null;
    schliessen();
    return aktion(async () => {
      for (let i = 0; i < anzahl; i++) {
        const b = plusTage(beginn, 7 * i);
        await api('/termine', { methode: 'POST', daten: { klient_id: k, therapie_id: th || undefined, terminart_id: art, beginn: b.toISOString(), ende: new Date(+b + dauer * 60000).toISOString() } });
      }
      S.woche = montag(beginn);
    });
  }
  if (f.id === 'tdoku') {
    const dokumentation = f.querySelector('#td').value.trim();
    schliessen();
    return aktion(() => api(`/termine/${f.dataset.id}`, { methode: 'PUT', daten: { dokumentation } }));
  }
});

addEventListener('hashchange', async () => {
  if (location.hash === '#umsaetze') { await ladeUmsatzStatus(); await ladeUmsaetze(); }
  if (location.hash === '#rechnungen') await ladeVorschau();
  if (location.hash === '#eingang') { await ladeEingang().catch((x) => { S.fehler = x.message; }); eingangBeobachten(); }
  if (['#einstellungen', '#system'].includes(location.hash)) { render(); try { KONF = await api('/konfiguration'); } catch (x) { S.fehler = x.message; } }
  render();
});
addEventListener('keydown', (e) => {
  if (e.key === 'Escape') schliessen();
  if (e.key === 'Enter' && e.target.matches?.('.kl-zeile[data-kl]')) e.target.click(); // Klientenzeile per Tastatur öffnen
});

// Start
(async () => {
  try { await laden(); } catch (e) { S.fehler = `Daten konnten nicht geladen werden: ${e.message}`; }
  await ladeUmsatzStatus();
  await ladeEingangZaehler();
  if (location.hash === '#umsaetze') await ladeUmsaetze();
  if (location.hash === '#eingang') { await ladeEingang().catch((x) => { S.fehler = x.message; }); eingangBeobachten(); }
  await ladeVorschau();
  if (['#einstellungen', '#system'].includes(location.hash)) { try { KONF = await api('/konfiguration'); } catch (x) { S.fehler = x.message; } }
  render();
})();
// Zähler und Daten jede Minute aktualisieren (z.B. neue Umsätze nach dem Abruf um 08:00/16:00)
setInterval(async () => {
  if (pop.classList.contains('on') || document.activeElement?.closest('form')) return; // Eingaben nicht stören
  await ladeUmsatzStatus();
  await ladeEingangZaehler();
  if (location.hash === '#eingang' && E.tab !== 'euer') await ladeEingang().catch(() => {});
  if (location.hash === '#umsaetze' && U.neu) await ladeUmsaetze();
  try { await laden(); } catch { /* nächster Versuch */ }
  render();
}, 60000);
