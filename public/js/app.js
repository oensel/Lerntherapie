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
const KT = { eltern: 'Selbstzahler', jugendamt: 'Jugendamt (§ 35a SGB VIII)' };

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
const R = { monat: null, vorschau: null, auswahl: null, mahn: [] };
const monatVon = (d) => tagStr(d).slice(0, 7);
const vormonatStr = () => { const d = new Date(); return monatVon(new Date(d.getFullYear(), d.getMonth() - 1, 1)); };
const monatText = (m) => monatName(new Date(m + '-01T12:00'));
const RST = { offen: ['Offen', '--plan'], bezahlt: ['Bezahlt', '--ok'], storniert: ['Storniert', '--abs'], ueberfaellig: ['Überfällig', '--unent'] };
const reSt = (r) => { const s = r.status === 'offen' && tagStr(new Date(r.faellig_am)) < heute() ? 'ueberfaellig' : r.status; return `<span class="st" style="--c:var(${RST[s][1]})">${RST[s][0]}${r.status === 'offen' && r.mahnstufe ? ` · ${r.mahnstufe}. Stufe` : ''}</span>`; };
const S = { woche: montag(new Date()), fehler: null };

function abbildenTermin(t) {
  const b = new Date(t.beginn);
  return { id: t.id, k: t.klient_id, d: lokal(b), beginn: b, dauer: Math.round((new Date(t.ende) - b) / 60000), s: t.status, txt: t.dokumentation || '' };
}

function abbildenKlient(k) {
  const eigene = T.filter((t) => t.k === k.id).sort((a, b) => a.d.localeCompare(b.d));
  const neu = !eigene.some((t) => t.s === 'stattgefunden');
  const erster = neu ? eigene.find((t) => t.s !== 'abgesagt')?.d ?? null : null;
  return {
    id: k.id, roh: k,
    name: `${k.vorname} ${k.nachname}`,
    geb: k.geburtsjahr ?? '—',
    schwer: k.schwerpunkt || '—',
    kontakt: [k.sorgeberechtigte, k.telefon].filter(Boolean).join(' · ') || '—',
    email: k.email,
    satz: (k.stundensatz_cent ?? 0) / 100,
    kostentraeger: KT[k.kostentraeger] ?? k.kostentraeger,
    seit: k.aufnahme_datum,
    aktiv: k.aktiv,
    erster,
    material: k.material_noetig
      ? { versandt: !!k.material_versandt_am, am: k.material_versandt_am, wie: k.material_versand_art }
      : null,
  };
}

async function laden() {
  const [kl, te, re] = await Promise.all([api('/klienten?archiv=true'), api('/termine'), api('/rechnungen')]);
  RE = re;
  T = te.map(abbildenTermin);
  KL = kl.map(abbildenKlient);
}

const kl = (id) => KL.find((k) => k.id == id) ?? { name: '(gelöscht)', satz: 0, kostentraeger: '' };
// Material-Erinnerungen: Ersttermin steht noch bevor oder Material ist noch nicht verschickt
const materialListe = () => KL.filter((k) => k.aktiv && k.material && k.erster && (tageBis(k.erster) >= 0 || !k.material.versandt))
  .sort((a, b) => a.erster.localeCompare(b.erster));
const offen = () => materialListe().filter((k) => !k.material.versandt && tageBis(k.erster) <= 7);

// ---------- Umsätze (FinTS) ----------
const U = { neu: 0, liste: [], status: {}, neuIds: new Set(), nur: '' };
async function ladeUmsatzStatus() { try { U.status = await api('/umsaetze/status'); U.neu = U.status.neu; } catch { /* Server nicht erreichbar */ } }
async function ladeUmsaetze() {
  U.liste = await api('/umsaetze' + (U.nur ? `?nur=${U.nur}` : ''));
  U.liste.filter((u) => !u.gesehen).forEach((u) => U.neuIds.add(u.id));
  if (U.neu) { await api('/umsaetze/gesehen', { methode: 'POST' }); U.neu = 0; }
}

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
    const lauf = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1, 6);
    const abrechenbar = KL.filter((k) => k.aktiv && T.some((t) => t.k === k.id && t.d.startsWith(h.slice(0, 7)) && t.s !== 'abgesagt')).length;
    return `<h1>${gruss}</h1><p class="sub">${new Date().toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })} · ${heuteT.length === 1 ? "1 Termin" : heuteT.length + " Termine"} heute</p>
<div class="grid"><div class="card"><h2>Material vor dem Ersttermin</h2>${rem.map((k) => {
      const d = tageBis(k.erster), m = k.material;
      return `<div class="rem"><div class="days ${!m.versandt && d <= 7 ? 'due' : ''}">${d}<small>Tage</small></div><div><b>${esc(k.name)}</b><br><span class="sub" style="margin:0">Ersttermin ${fd(k.erster)}, ${ft(k.erster)} · ${m.versandt ? `versandt am ${datum(m.am)} (${esc(m.wie)})` : d <= 7 ? '<span class="mark">jetzt versenden</span>' : 'Erinnerung ab ' + datum(new Date(k.erster) - 7 * 864e5)}</span></div>${m.versandt ? '<span class="st" style="--c:var(--ok)">erledigt</span>' : `<button data-send="${k.id}" ${d > 7 ? 'disabled' : ''}>Versandt</button>`}</div>`;
    }).join('') || '<p class="sub">Keine neuen Klienten mit anstehendem Ersttermin.</p>'}</div>
<div class="card"><h2>Heute</h2>${heuteT.map((t) => `<div class="rem"><div class="days" style="font-size:16px">${ft(t.d)}</div><div><b>${esc(kl(t.k).name)}</b><br>${st(t.s)}</div><button data-term="${t.id}">Status</button></div>`).join('') || '<p class="sub">Heute keine Termine.</p>'}
<h2 style="margin-top:20px">Nächster Rechnungslauf</h2><p style="margin:0">${lauf.toLocaleDateString('de-DE', { weekday: 'long' })}, <b>${datum(lauf)}, 06:00 Uhr</b> – automatisch für ${monatName(new Date())}.<br><span class="sub">Vorschau: ${abrechenbar} Rechnungen</span></p><button data-go="rechnungen" style="margin-top:10px">Vorschau ansehen</button></div></div>`;
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
      return `<button class="ev ${t.s === 'abgesagt' ? 'x' : ''}" style="${pos}--c:var(${ST[t.s][1]})" data-term="${t.id}"><b>${esc(kl(t.k).name)}</b>${ft(t.d)} · ${ST[t.s][0].split(' ')[0]}</button>`;
    };
    return `<div class="row"><div><h1>Kalender</h1><p class="sub">KW ${kw} · ${datum(S.woche)} – ${datum(plusTage(S.woche, 6))} · Termin antippen, um den Status zu setzen</p></div><span class="sp"></span><button data-woche="-1" aria-label="Vorige Woche">‹</button><button data-woche="0">Heute</button><button data-woche="1" aria-label="Nächste Woche">›</button><button class="pri" data-neutermin>+ Termin</button></div>
<div class="cal" style="grid-template-columns:48px repeat(${sichtbar.length},minmax(0,1fr))"><div class="h"></div>${sichtbar.map((d) => `<div class="h ${tagStr(d) === heute() ? 'today' : ''}">${fd(d)}</div>`).join('')}
<div>${hs.map((h) => `<div class="t">${h}:00</div>`).join('')}</div>
${sichtbar.map((d) => `<div class="col" style="height:${hs.length * 56}px">${woche.filter((t) => t.d.startsWith(tagStr(d))).map((t) => ev(t, true)).join('')}</div>`).join('')}</div>
<div class="agenda">${sichtbar.map((d) => { const ts = woche.filter((t) => t.d.startsWith(tagStr(d))).sort((a, b) => a.d.localeCompare(b.d)); return `<div class="tag ${tagStr(d) === heute() ? 'today' : ''}">${fd(d)}</div>${ts.map((t) => ev(t, false)).join('') || '<div class="sub">keine Termine</div>'}`; }).join('')}</div>
<div class="row" style="margin-top:12px">${Object.keys(ST).map(st).join('')}</div>`;
  },

  klienten() {
    const such = (S.suche || '').toLowerCase();
    const zeig = KL.filter((k) => (V._arch ? !k.aktiv : k.aktiv) && (!such || k.name.toLowerCase().includes(such)));
    return `<div class="row"><div><h1>Klienten</h1><p class="sub">${KL.filter((k) => k.aktiv).length} aktiv · ${KL.filter((k) => !k.aktiv).length} archiviert</p></div><span class="sp"></span><input data-suche placeholder="Suchen …" style="width:200px" value="${esc(S.suche || '')}"><button data-arch>${V._arch ? 'Aktive zeigen' : 'Archiv zeigen'}</button><button class="pri" data-edit="0">+ Neuer Klient</button></div>
<table class="stack"><thead><tr><th>Name</th><th>Schwerpunkt</th><th>Kostenträger</th><th>Nächster Termin</th><th class="n">Satz</th></tr></thead><tbody>
${zeig.map((k) => { const n = T.filter((t) => t.k === k.id && t.s === 'geplant' && t.beginn >= new Date()).sort((a, b) => a.d.localeCompare(b.d))[0]; return `<tr class="click" data-kl="${k.id}"><td><b>${esc(k.name)}</b><br><span class="sub">Jg. ${esc(k.geb)}</span></td><td>${esc(k.schwer)}</td><td>${esc(k.kostentraeger)}</td><td>${n ? fd(n.d) + ', ' + ft(n.d) : '—'}</td><td class="n">${eur(k.satz)}</td></tr>`; }).join('') || '<tr><td colspan="5" class="sub">Keine Klienten.</td></tr>'}</tbody></table>`;
  },

  akte() {
    const k = kl(V._k), hist = T.filter((t) => t.k === k.id).sort((a, b) => b.d.localeCompare(a.d)), tab = V._tab || 'hist';
    const z = (s) => hist.filter((t) => t.s === s).length;
    return `<button data-go="klienten">‹ Alle Klienten</button><div class="row" style="margin-top:12px"><div><h1>${esc(k.name)}</h1><p class="sub">${esc(k.schwer)} · ${esc(k.kostentraeger)} · ${eur(k.satz)} je Einheit</p></div><span class="sp"></span><button data-edit="${k.id}">Bearbeiten</button><button data-archive="${k.id}">${k.aktiv ? 'Archivieren' : 'Reaktivieren'}</button><button class="pri" data-doku="${k.id}">+ Eintrag</button></div>
<div class="row">${['stattgefunden', 'ausgefallen', 'unentschuldigt', 'abgesagt'].map((s) => `<div class="card" style="flex:1;min-width:130px"><div style="font-size:24px;font-weight:700">${z(s)}</div>${st(s)}</div>`).join('')}</div>
<div class="tabs">${[['hist', 'Terminhistorie'], ['stamm', 'Stammdaten'], ['re', 'Rechnungen']].map(([i, l]) => `<button data-tab="${i}" class="${tab === i ? 'on' : ''}">${l}</button>`).join('')}</div>
${tab === 'hist' ? `<div class="tl">${hist.map((t) => `<div style="--c:var(${ST[t.s][1]})"><b>${fd(t.d)} ${ft(t.d)}</b> · ${st(t.s)} <button data-term="${t.id}" style="min-height:30px;font-size:13px;margin-left:6px">ändern</button><div>${t.txt ? esc(t.txt) : '<span class="sub">Keine Aufzeichnung</span>'}</div></div>`).join('') || '<p class="sub">Noch keine Termine.</p>'}</div>`
      : tab === 'stamm' ? `<div class="grid"><div class="card"><label>Kontakt (Erziehungsberechtigte)</label>${esc(k.kontakt)}<label>E-Mail</label>${esc(k.email || '—')}<label>Jahrgang</label>${esc(k.geb)}<label>In Therapie seit</label>${k.seit ? datum(k.seit) : k.erster ? 'Ersttermin ' + fd(k.erster) : '—'}</div><div class="card"><label>Rechnungsempfänger</label>${esc(k.kostentraeger)}<label>Abrechnung</label>Stattgefunden + ausgefallen + unentschuldigt; abgesagt (≥ 24 h) kostenfrei</div></div>`
        : `<table><thead><tr><th>Nr.</th><th>Monat</th><th class="n">Betrag</th><th>Status</th></tr></thead><tbody>${RE.filter((r) => r.klient_id === k.id).map((r) => `<tr><td><a href="/api/rechnungen/${r.id}/pdf" target="_blank">${esc(r.nummer)}</a></td><td>${monatText(r.leistungsmonat)}</td><td class="n">${eur(r.betrag_cent / 100)}</td><td>${reSt(r)}</td></tr>`).join('') || '<tr><td colspan="4" class="sub">Noch keine Rechnungen.</td></tr>'}</tbody></table>`}`;
  },

  doku() {
    const jetzt = new Date(); jetzt.setMinutes(jetzt.getMinutes() < 30 ? 0 : 30, 0, 0);
    // Vorschlag: der letzte geplante Termin des gewählten Klienten bis heute
    const vorschlag = V._k && T.filter((t) => t.k == V._k && t.s === 'geplant' && t.d.slice(0, 10) <= heute()).sort((a, b) => b.d.localeCompare(a.d))[0];
    return `<h1>Sitzung dokumentieren</h1><p class="sub">Was wurde wann gemacht – landet automatisch in der Terminhistorie des Klienten.</p>
<form class="card" id="dform" style="max-width:640px"><label for="dk">Klient</label><select id="dk">${KL.filter((k) => k.aktiv).map((k) => `<option value="${k.id}" ${k.id == V._k ? 'selected' : ''}>${esc(k.name)}</option>`).join('')}</select>
<div class="grid" style="gap:10px"><div><label for="dd">Datum &amp; Uhrzeit</label><input id="dd" type="datetime-local" required value="${vorschlag ? vorschlag.d : lokal(jetzt)}"></div><div><label for="dm">Dauer</label><select id="dm">${[45, 60, 90].map((m) => `<option value="${m}" ${m === (vorschlag?.dauer ?? 60) ? 'selected' : ''}>${m} Minuten</option>`).join('')}</select></div></div>
<label for="dt">Inhalte / Übungen</label><textarea id="dt" rows="4" placeholder="z. B. Silbenschwingen, Lesetext S. 4–6, Diktat mit Fehleranalyse"></textarea>
<label for="db">Beobachtungen</label><textarea id="db" rows="3" placeholder="Konzentration, Motivation, Fortschritte"></textarea>
<label for="dh">Hausaufgabe / nächste Schritte</label><input id="dh">
<div class="row" style="margin-top:16px"><span class="sp"></span><button type="reset">Leeren</button><button class="pri">Speichern &amp; als stattgefunden markieren</button></div></form>`;
  },

  rechnungen() {
    const m = R.monat ||= vormonatStr();
    const vs = R.vorschau?.monat === m ? R.vorschau.liste : null;
    const neu = vs?.filter((v) => !v.bereits_berechnet && v.betrag_cent > 0) ?? [];
    const lauf = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1, 6);
    const offen = RE.filter((r) => r.status === 'offen'), summeOffen = offen.reduce((a, r) => a + r.betrag_cent, 0);
    const p = R.auswahl;
    const monate = Array.from({ length: 12 }, (_, i) => { const d = new Date(); return monatVon(new Date(d.getFullYear(), d.getMonth() - i, 1)); });
    return `<div class="row"><div><h1>Rechnungen</h1><p class="sub">Automatischer Lauf am 1. jedes Monats, 06:00 Uhr (nächster: ${datum(lauf)}) · Zahlungseingänge werden nach jedem Kontoabruf zugeordnet</p></div><span class="sp"></span><button data-abgleich>Zahlungen abgleichen</button></div>
<div class="row"><div class="card" style="flex:1"><div class="sub" style="margin:0">Offen</div><b style="font-size:20px">${eur(summeOffen / 100)}</b> <span class="sub">(${offen.length})</span></div><div class="card" style="flex:1"><div class="sub" style="margin:0">Überfällig</div><b style="font-size:20px">${offen.filter((r) => tagStr(new Date(r.faellig_am)) < heute()).length}</b></div></div>
${R.mahn.length ? `<div class="card" style="margin-bottom:14px"><h2>Fällige Mahnungen</h2><table class="stack"><thead><tr><th>Nr.</th><th>Klient</th><th>Fällig seit</th><th class="n">Betrag</th><th></th></tr></thead><tbody>${R.mahn.map((r) => `<tr><td>${esc(r.nummer)}</td><td>${esc(r.klient_name)}</td><td>${datum(r.faellig_am)}</td><td class="n">${eur(r.betrag_cent / 100)}</td><td class="n"><button data-mahnen="${r.id}">${esc(r.faellige_art)} erstellen</button></td></tr>`).join('')}</tbody></table><p class="hint">Vor dem Mahnen „Zahlungen abgleichen“, damit eingegangene Zahlungen berücksichtigt sind.</p></div>` : ''}
<div class="grid"><div class="card"><div class="row"><h2 style="margin:0">Abrechnung</h2><span class="sp"></span><select data-remonat style="width:auto">${monate.map((x) => `<option value="${x}" ${x === m ? 'selected' : ''}>${monatText(x)}</option>`).join('')}</select></div>
<table class="stack"><thead><tr><th>Klient</th><th class="n">Einheiten</th><th class="n">Betrag</th></tr></thead><tbody>${!vs ? '<tr><td colspan="3" class="sub">Lädt …</td></tr>' : vs.map((v) => `<tr><td>${esc(v.name)}${v.bereits_berechnet ? ' <span class="st" style="--c:var(--ok)">berechnet</span>' : ''}${v.ohne_status ? ` <span class="st" style="--c:var(--aus)">${v.ohne_status} ohne Status</span>` : ''}${v.noch_geplant ? ` <span class="sub">${v.noch_geplant} noch geplant</span>` : ''}</td><td class="n">${v.positionen.length}</td><td class="n">${eur(v.betrag_cent / 100)}</td></tr>`).join('') || '<tr><td colspan="3" class="sub">Nichts abzurechnen.</td></tr>'}</tbody></table>
<p class="hint">Berechnet werden stattgefundene, ausgefallene und unentschuldigte Termine. Vergangene Termine ohne Status bitte vorher prüfen – sie werden nicht berechnet.</p><div class="row"><span class="sp"></span><button class="pri" data-lauf ${neu.length ? '' : 'disabled'}>${neu.length} Rechnung${neu.length === 1 ? '' : 'en'} erstellen</button></div>
<h2 style="margin-top:20px">Erstellte Rechnungen</h2><table class="stack"><thead><tr><th>Nr.</th><th>Klient</th><th>Monat</th><th class="n">Betrag</th><th>Status</th></tr></thead><tbody>${RE.map((r) => `<tr data-re="${r.id}" style="cursor:pointer${p?.id === r.id ? ';background:var(--sel, #eef3f6)' : ''}"><td>${esc(r.nummer)}${r.versendet_am ? ' <span title="per E-Mail versendet">✉</span>' : ''}</td><td>${esc(r.klient_name)}</td><td>${monatText(r.leistungsmonat)}</td><td class="n">${eur(r.betrag_cent / 100)}</td><td>${reSt(r)}</td></tr>`).join('') || '<tr><td colspan="5" class="sub">Noch keine Rechnungen erstellt.</td></tr>'}</tbody></table></div>
<div>${p ? `<div class="paper"><div class="row"><div><h3>Rechnung ${esc(p.nummer)}</h3>${datum(p.rechnungsdatum)} · fällig ${datum(p.faellig_am)}</div><span class="sp"></span>${reSt(p)}</div><p style="white-space:pre-line">${esc(p.empfaenger)}</p><p>betr. ${esc(p.klient_name)} · Leistungszeitraum: ${monatText(p.leistungsmonat)}</p>
<table><thead><tr><th>Datum</th><th>Leistung</th><th class="n">Betrag</th></tr></thead><tbody>${p.positionen.map((x) => `<tr><td>${datum(x.datum)}</td><td>${esc(x.beschreibung)}</td><td class="n">${eur(x.betrag_cent / 100)}</td></tr>`).join('')}<tr><td></td><td><b>Gesamt</b></td><td class="n"><b>${eur(p.betrag_cent / 100)}</b></td></tr></tbody></table>
${p.mahnungen?.length ? `<p><b>Mahnungen</b><br>${p.mahnungen.map((x) => `<a href="/api/rechnungen/mahnungen/${x.id}/pdf" target="_blank">${esc(x.art)}</a> vom ${datum(x.datum)}, Frist ${datum(x.frist)}${x.gebuehr_cent ? `, Gebühr ${eur(x.gebuehr_cent / 100)}` : ''} · ${x.versendet_am ? `per E-Mail am ${datum(x.versendet_am)}` : `<a href="#" data-mail="/rechnungen/mahnungen/${x.id}">per E-Mail senden</a>`}`).join('<br>')}</p>` : ''}
${p.versand?.length ? `<p class="sub">${p.versand.map((v) => `${v.fehler ? '⚠ ' : '✉ '}${new Date(v.gesendet_am).toLocaleString('de-DE')} an ${esc(v.an)}: ${esc(v.betreff)}${v.fehler ? ` – <b>fehlgeschlagen</b> (${esc(v.fehler)})` : ''}`).join('<br>')}</p>` : ''}
${p.bezahlt_am ? `<p class="sub">Bezahlt am ${datum(p.bezahlt_am)}${p.umsatz_id ? ' (Kontoumsatz zugeordnet)' : ''}</p>` : ''}</div>
<div class="row" style="margin-top:8px"><a href="/api/rechnungen/${p.id}/pdf" target="_blank" class="btn">PDF öffnen</a>${p.status !== 'storniert' ? `<button data-mail="/rechnungen/${p.id}">${p.versendet_am ? 'Erneut per E-Mail' : 'Per E-Mail senden'}</button>` : ''}${p.status === 'offen' ? `<button data-rest="bezahlt">Als bezahlt markieren</button>${p.mahnstufe < 3 && tagStr(new Date(p.faellig_am)) < heute() ? `<button data-mahnen="${p.id}" data-sofort>${['Zahlungserinnerung', 'Mahnung', 'Letzte Mahnung'][p.mahnstufe]} erstellen</button>` : ''}<button data-rest="storniert">Stornieren</button>` : p.status === 'bezahlt' ? '<button data-rest="offen">Wieder offen</button>' : ''}</div>` : '<p class="sub">Rechnung in der Liste auswählen.</p>'}</div></div>`;
  },

  umsaetze() {
    const s = U.status;
    const ein = U.liste.filter((u) => u.betrag_cent > 0).reduce((a, u) => a + u.betrag_cent, 0);
    const aus = U.liste.filter((u) => u.betrag_cent < 0).reduce((a, u) => a + u.betrag_cent, 0);
    return `<div class="row"><div><h1>Umsätze</h1><p class="sub">Automatischer Abruf täglich 08:00 und 16:00 Uhr · letzter erfolgreicher Abruf: ${s.letzter_erfolg ? new Date(s.letzter_erfolg).toLocaleString('de-DE') : 'noch keiner'}</p></div><span class="sp"></span><select data-filter style="width:auto">${[['', 'Alle'], ['eingang', 'Eingänge'], ['ausgang', 'Ausgänge']].map(([v, l]) => `<option value="${v}" ${U.nur === v ? 'selected' : ''}>${l}</option>`).join('')}</select><button class="pri" data-abruf ${s.laeuft ? 'disabled' : ''}>${s.laeuft ? 'Abruf läuft …' : 'Jetzt abrufen'}</button></div>
${s.freigabe_noetig ? '<p class="hint"><b>Freigabe nötig:</b> Bitte den Abruf in der S-pushTAN-App bestätigen (die Bank verlangt das etwa alle 90 Tage).</p>' : s.letzter_fehler ? `<p class="hint"><b>Letzter Abruf fehlgeschlagen:</b> ${esc(s.letzter_fehler)}</p>` : ''}
<div class="row"><div class="card" style="flex:1"><div class="sub" style="margin:0">Eingänge</div><b style="font-size:20px">${eur(ein / 100)}</b></div><div class="card" style="flex:1"><div class="sub" style="margin:0">Ausgänge</div><b style="font-size:20px">${eur(aus / 100)}</b></div></div>
<table class="stack"><thead><tr><th>Datum</th><th>Auftraggeber / Empfänger</th><th>Verwendungszweck</th><th class="n">Betrag</th></tr></thead><tbody>
${U.liste.map((u) => `<tr><td>${datum(u.buchungsdatum)}${U.neuIds.has(u.id) ? ' <span class="badge">neu</span>' : ''}</td><td><b>${esc(u.gegen_name || u.buchungstext || '—')}</b>${u.gegen_iban ? `<br><span class="sub">${esc(u.gegen_iban)}</span>` : ''}</td><td>${esc(u.verwendungszweck)}</td><td class="n" style="color:${u.betrag_cent < 0 ? 'var(--unent)' : 'var(--ok)'};font-weight:600">${eur(u.betrag_cent / 100)}</td></tr>`).join('') || '<tr><td colspan="4" class="sub">Noch keine Umsätze abgerufen.</td></tr>'}</tbody></table>`;
  },
};

// ---------- Rahmen ----------
const NAV = [['uebersicht', 'Übersicht'], ['kalender', 'Kalender'], ['klienten', 'Klienten'], ['doku', 'Dokumentieren'], ['rechnungen', 'Rechnungen'], ['umsaetze', 'Umsätze']];
const nav = document.getElementById('nav'), main = document.getElementById('main'), pop = document.getElementById('pop'), dlg = document.getElementById('dlg');

function ansicht() {
  let v = location.hash.slice(1) || 'uebersicht';
  if (!V[v] || (v === 'akte' && !V._k)) v = 'uebersicht';
  return v;
}

function render() {
  const v = ansicht();
  nav.innerHTML = nav.firstElementChild.outerHTML + NAV.map(([i, l]) => `<a href="#${i}" class="${v === i || (v === 'akte' && i === 'klienten') ? 'on' : ''}">${l}${i === 'uebersicht' && offen().length ? `<span class="badge">${offen().length}</span>` : ''}${i === 'rechnungen' && R.mahn.length ? `<span class="badge" title="fällige Mahnungen">${R.mahn.length}</span>` : ''}${i === 'umsaetze' && U.neu ? `<span class="badge" title="neue Umsätze">${U.neu}</span>` : ''}</a>`).join('');
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

// ---------- Dialoge ----------
function statusDialog(id) {
  const t = T.find((x) => x.id == id), k = kl(t.k), h = (t.beginn - new Date()) / 36e5, vor = h > 0;
  dlg.innerHTML = `<h2>${esc(k.name)}</h2><div class="sub" style="margin:0">${fd(t.d)}, ${ft(t.d)} · aktuell ${st(t.s)}</div>
<p class="hint">${h >= 24 ? 'Mehr als 24 h vorher: kostenfreie Absage möglich.' : vor ? `Noch ${Math.round(h)} h bis zum Termin – Absage gilt als <b>ausgefallen</b> und wird berechnet.` : 'Termin liegt in der Vergangenheit.'}</p>
<div class="opts">${[['stattgefunden', 'Hat wie geplant stattgefunden', vor], ['abgesagt', 'Rechtzeitig abgesagt, nicht berechnet', h < 24], ['ausgefallen', 'Kurzfristig gemeldet, wird berechnet', false], ['unentschuldigt', 'Ohne Nachricht nicht erschienen, wird berechnet', vor], ['geplant', 'Zurück auf geplant', false]].map(([s, d, dis]) => `<button data-set="${s}" data-id="${id}" ${dis || s === t.s ? 'disabled' : ''} style="--c:var(${ST[s][1]})"><span class="st"></span><span><b>${ST[s][0]}</b><small>${d}</small></span></button>`).join('')}</div>
<div class="row"><button data-doku="${k.id}" data-termin="${t.id}">Aufzeichnung schreiben</button><button data-loesch="${t.id}">Termin löschen</button><span class="sp"></span><button data-close>Schließen</button></div>`;
  pop.classList.add('on');
}

function klientDialog(id) {
  const k = id ? kl(id).roh : { vorname: '', nachname: '', kostentraeger: 'eltern', stundensatz_cent: 5800, material_noetig: true };
  const f = (n, l, typ = 'text', extra = '') => `<label for="f-${n}">${l}</label><input id="f-${n}" name="${n}" type="${typ}" value="${esc(k[n] ?? '')}" ${extra}>`;
  dlg.innerHTML = `<h2>${id ? 'Klient bearbeiten' : 'Neuer Klient'}</h2><form id="kform" data-id="${id || ''}">
<div class="grid" style="gap:10px"><div>${f('vorname', 'Vorname', 'text', 'required')}</div><div>${f('nachname', 'Nachname', 'text', 'required')}</div></div>
<div class="grid" style="gap:10px"><div>${f('geburtsjahr', 'Jahrgang', 'number', 'min="1990" max="2030"')}</div><div>${f('schwerpunkt', 'Schwerpunkt')}</div></div>
${f('sorgeberechtigte', 'Erziehungsberechtigte')}
<div class="grid" style="gap:10px"><div>${f('telefon', 'Telefon', 'tel')}</div><div>${f('email', 'E-Mail', 'email')}</div></div>
<div class="grid" style="gap:10px"><div><label for="f-kt">Kostenträger</label><select id="f-kt" name="kostentraeger">${Object.entries(KT).map(([v, l]) => `<option value="${v}" ${k.kostentraeger === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
<div><label for="f-satz">Stundensatz (€)</label><input id="f-satz" name="satz" type="number" step="0.01" min="0" value="${((k.stundensatz_cent ?? 0) / 100).toFixed(2)}"></div></div>
${f('aufnahme_datum', 'In Therapie seit', 'date')}
<label style="display:flex;gap:8px;align-items:center;margin-top:12px"><input type="checkbox" name="material_noetig" style="width:auto;min-height:0" ${k.material_noetig ? 'checked' : ''}> Material vor dem Ersttermin verschicken</label>
<div class="row" style="margin-top:14px"><span class="sp"></span><button type="button" data-close>Abbrechen</button><button class="pri">Speichern</button></div></form>`;
  if (k.aufnahme_datum) dlg.querySelector('[name=aufnahme_datum]').value = tagStr(new Date(k.aufnahme_datum));
  pop.classList.add('on');
}

function terminDialog() {
  const start = plusTage(S.woche, Math.min(4, Math.max(0, (new Date().getDay() + 6) % 7)));
  start.setHours(14, 0, 0, 0);
  dlg.innerHTML = `<h2>Neuer Termin</h2><form id="tform"><label for="t-k">Klient</label><select id="t-k" required>${KL.filter((k) => k.aktiv).map((k) => `<option value="${k.id}">${esc(k.name)}</option>`).join('')}</select>
<div class="grid" style="gap:10px"><div><label for="t-d">Beginn</label><input id="t-d" type="datetime-local" required value="${lokal(start)}" step="900"></div><div><label for="t-m">Dauer</label><select id="t-m">${[45, 60, 90].map((m) => `<option value="${m}" ${m === 60 ? 'selected' : ''}>${m} Minuten</option>`).join('')}</select></div></div>
<label for="t-w">Wiederholen</label><select id="t-w"><option value="1">einmalig</option><option value="4">wöchentlich, 4 Termine</option><option value="8">wöchentlich, 8 Termine</option><option value="12">wöchentlich, 12 Termine</option></select>
<div class="row" style="margin-top:14px"><span class="sp"></span><button type="button" data-close>Abbrechen</button><button class="pri">Anlegen</button></div></form>`;
  pop.classList.add('on');
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

// ---------- Ereignisse ----------
document.addEventListener('click', (e) => {
  if (e.target === pop) return schliessen();
  const b = e.target.closest('[data-term],[data-set],[data-close],[data-send],[data-material],[data-go],[data-kl],[data-tab],[data-edit],[data-archive],[data-doku],[data-arch],[data-neutermin],[data-woche],[data-loesch],[data-abruf],[data-re],[data-rest],[data-lauf],[data-abgleich],[data-mahnen],[data-mail]');
  if (!b) return;
  const d = b.dataset;
  if (d.term) return statusDialog(d.term);
  if (d.set) { schliessen(); return aktion(() => api(`/termine/${d.id}`, { methode: 'PUT', daten: { status: d.set } })); }
  if ('close' in d) return schliessen();
  if (d.send) return materialDialog(d.send);
  if (d.material) { schliessen(); return aktion(() => api(`/klienten/${d.material}`, { methode: 'PUT', daten: { material_versandt_am: heute(), material_versand_art: d.wie } })); }
  if (d.loesch) { if (!confirm('Termin wirklich löschen?')) return; schliessen(); return aktion(() => api(`/termine/${d.loesch}`, { methode: 'DELETE' })); }
  if (d.go) { location.hash = d.go; return; }
  if (d.kl) { V._k = +d.kl; V._tab = 'hist'; location.hash = 'akte'; return render(); }
  if (d.tab) { V._tab = d.tab; return render(); }
  if (d.edit !== undefined) return klientDialog(+d.edit);
  if (d.archive) { const k = kl(d.archive); return aktion(() => api(`/klienten/${k.id}`, { methode: 'PUT', daten: { aktiv: !k.aktiv } })); }
  if (d.doku) { V._k = +d.doku; schliessen(); location.hash = 'doku'; return render(); }
  if ('arch' in d) { V._arch = !V._arch; return render(); }
  if ('neutermin' in d) return terminDialog();
  if (d.woche !== undefined) { S.woche = +d.woche ? plusTage(S.woche, 7 * +d.woche) : montag(new Date()); return render(); }
  if (d.re) return api(`/rechnungen/${d.re}`).then((r) => { R.auswahl = r; render(); });
  if (d.rest) {
    if (d.rest === 'storniert' && !confirm('Rechnung stornieren? Die Termine werden wieder abrechenbar.')) return;
    const id = R.auswahl.id;
    return aktion(async () => { await api(`/rechnungen/${id}/status`, { methode: 'PUT', daten: { status: d.rest } }); R.auswahl = await api(`/rechnungen/${id}`); await ladeVorschau(); });
  }
  if (d.mail) { e.preventDefault(); return mailDialog(d.mail).catch((x) => { S.fehler = x.message; render(); }); }
  if (d.mahnen) return aktion(async () => {
    const m = await api(`/rechnungen/${d.mahnen}/mahnung`, { methode: 'POST', daten: { erzwingen: 'sofort' in d } });
    R.auswahl = await api(`/rechnungen/${d.mahnen}`); await ladeVorschau();
    window.open(`/api/rechnungen/mahnungen/${m.id}/pdf`, '_blank');
  });
  if ('lauf' in d) return aktion(async () => { const { erstellt } = await api('/rechnungen/lauf', { methode: 'POST', daten: { monat: R.monat } }); if (erstellt[0]) R.auswahl = await api(`/rechnungen/${erstellt[0].id}`); await ladeVorschau(); });
  if ('abgleich' in d) return aktion(async () => { const { bezahlt } = await api('/rechnungen/abgleich', { methode: 'POST' }); if (!bezahlt.length) alert('Keine neuen Zahlungen gefunden.'); });
  if ('abruf' in d) { api('/umsaetze/abruf', { methode: 'POST' }).then(async () => { await ladeUmsatzStatus(); render(); }); }
});

document.addEventListener('input', (e) => {
  if (e.target.matches('[data-suche]')) { S.suche = e.target.value; render(); }
});

document.addEventListener('change', async (e) => {
  if (e.target.matches('[data-filter]')) { U.nur = e.target.value; await ladeUmsaetze(); render(); }
  if (e.target.matches('[data-remonat]')) { R.monat = e.target.value; await ladeVorschau(); render(); }
  if (e.target.id === 'dk') { V._k = +e.target.value; render(); }
});

document.addEventListener('submit', (e) => {
  e.preventDefault();
  const f = e.target;
  if (f.id === 'kform') {
    const w = Object.fromEntries(new FormData(f));
    const daten = {
      vorname: w.vorname.trim(), nachname: w.nachname.trim(),
      geburtsjahr: w.geburtsjahr ? +w.geburtsjahr : null,
      schwerpunkt: w.schwerpunkt || null, sorgeberechtigte: w.sorgeberechtigte || null,
      telefon: w.telefon || null, email: w.email || null,
      kostentraeger: w.kostentraeger, stundensatz_cent: Math.round(parseFloat(w.satz || '0') * 100),
      aufnahme_datum: w.aufnahme_datum || null, material_noetig: 'material_noetig' in w,
    };
    schliessen();
    return aktion(() => (f.dataset.id ? api(`/klienten/${f.dataset.id}`, { methode: 'PUT', daten }) : api('/klienten', { methode: 'POST', daten })));
  }
  if (f.id === 'mform') {
    const daten = { an: f.querySelector('#m-an').value.trim(), betreff: f.querySelector('#m-b').value, text: f.querySelector('#m-t').value };
    const knopf = f.querySelector('.pri'); knopf.disabled = true; knopf.textContent = 'Wird gesendet …';
    return api(f.dataset.pfad + '/versand', { methode: 'POST', daten }).then(async () => {
      schliessen();
      await aktion(async () => { if (R.auswahl) R.auswahl = await api(`/rechnungen/${R.auswahl.id}`); });
    }).catch((x) => { knopf.disabled = false; knopf.textContent = 'Senden'; alert(x.message); });
  }
  if (f.id === 'tform') {
    const k = +f.querySelector('#t-k').value, beginn = new Date(f.querySelector('#t-d').value);
    const dauer = +f.querySelector('#t-m').value, anzahl = +f.querySelector('#t-w').value;
    schliessen();
    return aktion(async () => {
      for (let i = 0; i < anzahl; i++) {
        const b = plusTage(beginn, 7 * i);
        await api('/termine', { methode: 'POST', daten: { klient_id: k, beginn: b.toISOString(), ende: new Date(+b + dauer * 60000).toISOString() } });
      }
      S.woche = montag(beginn);
    });
  }
  if (f.id === 'dform') {
    const k = +f.querySelector('#dk').value, d = f.querySelector('#dd').value, dauer = +f.querySelector('#dm').value;
    const teile = [['', f.querySelector('#dt').value], ['Beobachtung: ', f.querySelector('#db').value], ['Hausaufgabe: ', f.querySelector('#dh').value]]
      .filter(([, v]) => v.trim()).map(([p, v]) => p + v.trim());
    const dokumentation = teile.join('\n');
    const vorhanden = T.find((t) => t.k === k && t.d === d);
    const beginn = new Date(d);
    return aktion(async () => {
      if (vorhanden) {
        await api(`/termine/${vorhanden.id}`, { methode: 'PUT', daten: { status: 'stattgefunden', dokumentation: [vorhanden.txt, dokumentation].filter(Boolean).join('\n'), ende: new Date(+beginn + dauer * 60000).toISOString() } });
      } else {
        await api('/termine', { methode: 'POST', daten: { klient_id: k, beginn: beginn.toISOString(), ende: new Date(+beginn + dauer * 60000).toISOString(), status: 'stattgefunden', dokumentation } });
      }
      V._k = k; V._tab = 'hist'; location.hash = 'akte';
    });
  }
});

addEventListener('hashchange', async () => {
  if (location.hash === '#umsaetze') { await ladeUmsatzStatus(); await ladeUmsaetze(); }
  if (location.hash === '#rechnungen') await ladeVorschau();
  render();
});
addEventListener('keydown', (e) => { if (e.key === 'Escape') schliessen(); });

// Start
(async () => {
  try { await laden(); } catch (e) { S.fehler = `Daten konnten nicht geladen werden: ${e.message}`; }
  await ladeUmsatzStatus();
  if (location.hash === '#umsaetze') await ladeUmsaetze();
  await ladeVorschau();
  render();
})();
// Zähler und Daten jede Minute aktualisieren (z.B. neue Umsätze nach dem Abruf um 08:00/16:00)
setInterval(async () => {
  if (pop.classList.contains('on') || document.activeElement?.closest('form')) return; // Eingaben nicht stören
  await ladeUmsatzStatus();
  if (location.hash === '#umsaetze' && U.neu) await ladeUmsaetze();
  try { await laden(); } catch { /* nächster Versuch */ }
  render();
}, 60000);
