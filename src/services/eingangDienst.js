// Rechnungseingang (Vorbild Dojo Pro): eigenes IMAP-Postfach für eingehende Rechnungen abrufen, Belege als „neu“ ablegen,
// nach dem Markieren als Eingangsrechnung mit Gemini auslesen und die Posten auf EÜR-Kategorien verteilen.
// Zugangsdaten kommen bei jeder Verwendung aus `werte()` (konfigDienst): RECHNUNG_IMAP_*, GEMINI_MODELL; GEMINI_API_KEY nur aus der .env (process.env).
import { anfrageText, istBeleg, kopfAusKi, postenAusKi, schema, schemaPruefen, SYSTEMANWEISUNG, KATEGORIE_NAMEN } from './eingangLogik.js';

const GEMINI_ZEITLIMIT_MS = 60_000;

/** Gemini über das SDK @google/genai aufrufen; gibt { text } zurück, Fehler tragen `status`. */
export async function geminiAufruf(req, apiKey) {
  const { GoogleGenAI } = await import('@google/genai');
  const client = new GoogleGenAI({ apiKey });
  let timer;
  const abgelaufen = new Promise((_, rej) => { timer = setTimeout(() => rej(Object.assign(new Error('Keine Antwort von Gemini innerhalb von 60 Sekunden'), { status: 504 })), GEMINI_ZEITLIMIT_MS); });
  try {
    const a = await Promise.race([client.models.generateContent({ ...req, config: { ...req.config, abortSignal: AbortSignal.timeout(GEMINI_ZEITLIMIT_MS) } }), abgelaufen]);
    return { text: a.text ?? '' };
  } finally { clearTimeout(timer); }
}

/** Neue (ungelesene) Mails des Rechnungspostfachs holen; je PDF/Bild-Anhang ein Datensatz mit Status „neu“. */
export async function postfachAbrufen(env) {
  if (!env.RECHNUNG_IMAP_HOST || !env.RECHNUNG_IMAP_USER || !env.RECHNUNG_IMAP_PASS) throw Object.assign(new Error('Rechnungspostfach ist nicht eingerichtet (Einstellungen, Reiter Rechnungseingang)'), { status: 400, expose: true });
  const { ImapFlow } = await import('imapflow');
  const { simpleParser } = await import('mailparser');
  const port = Number(env.RECHNUNG_IMAP_PORT || 993);
  const client = new ImapFlow({ host: env.RECHNUNG_IMAP_HOST, port, secure: port === 993, logger: false, connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 60000, auth: { user: env.RECHNUNG_IMAP_USER, pass: env.RECHNUNG_IMAP_PASS } });
  const mails = [];
  await client.connect();
  try {
    const lock = await client.getMailboxLock(env.RECHNUNG_IMAP_ORDNER || 'INBOX');
    try {
      const uids = (await client.search({ seen: false }, { uid: true })) || [];
      for (const uid of uids.slice(0, 200)) {
        const m = await client.fetchOne(uid, { source: { maxLength: 15 * 1024 * 1024 } }, { uid: true });
        if (m?.source) mails.push(await simpleParser(m.source));
        await client.messageFlagsAdd(uid, ['\\Seen'], { uid: true });
      }
    } finally { lock.release(); }
  } finally { await client.logout().catch(() => client.close()); }
  return mails;
}

/** Anmeldung am Rechnungspostfach prüfen (ohne Mails zu lesen); gibt die Zahl der ungelesenen Mails im Ordner zurück. */
export async function postfachTesten(env) {
  if (!env.RECHNUNG_IMAP_HOST || !env.RECHNUNG_IMAP_USER || !env.RECHNUNG_IMAP_PASS) throw Object.assign(new Error('Server, Benutzername und Passwort eintragen und speichern'), { status: 400, expose: true });
  const { ImapFlow } = await import('imapflow');
  const port = Number(env.RECHNUNG_IMAP_PORT || 993);
  const client = new ImapFlow({ host: env.RECHNUNG_IMAP_HOST, port, secure: port === 993, logger: false, connectionTimeout: 10000, greetingTimeout: 10000, auth: { user: env.RECHNUNG_IMAP_USER, pass: env.RECHNUNG_IMAP_PASS } });
  await client.connect();
  try {
    const s = await client.status(env.RECHNUNG_IMAP_ORDNER || 'INBOX', { unseen: true });
    return { ungelesen: s.unseen ?? 0 };
  } finally { await client.logout().catch(() => client.close()); }
}

export function erstelleEingangDienst(knex, { werte = async () => process.env, io = {} } = {}) {
  const gemini = io.gemini ?? geminiAufruf;
  const abrufen = io.postfach ?? postfachAbrufen;
  let warteschlange = Promise.resolve();

  /** Mails übernehmen; doppelte (gleiche Message-ID und Teil) werden übersprungen. Gibt die Zahl neuer Belege zurück. */
  async function mailsUebernehmen(mails) {
    let neu = 0;
    for (const m of mails) {
      const belege = (m.attachments || []).filter(istBeleg);
      const absender = m.from?.value?.[0]?.address || m.from?.text || null;
      for (const [i, a] of belege.entries()) {
        const z = await knex('eingangsrechnungen').insert({
          quelle: 'mail', mail_message_id: m.messageId?.slice(0, 250) || null, mail_teil: i + 1,
          mail_absender: absender?.slice(0, 250), mail_betreff: m.subject?.slice(0, 250) || null,
          empfangen_am: m.date || new Date(), dateiname: a.filename?.slice(0, 250) || `beleg-${i + 1}.pdf`, mime: a.contentType, datei: a.content,
        }).onConflict(knex.raw('(mail_message_id, mail_teil) where mail_message_id is not null')).ignore().returning('id');
        neu += z.length;
      }
    }
    return neu;
  }

  async function postfach() {
    return { neu: await mailsUebernehmen(await abrufen(await werte())) };
  }

  /** Beleg von Hand hochladen (Data-URL). */
  async function hochladen({ dateiname, daten }) {
    const m = /^data:([\w/+.-]+);base64,(.*)$/.exec(daten || '');
    if (!m || !istBeleg({ contentType: m[1], filename: dateiname })) throw Object.assign(new Error('Bitte ein PDF oder Bild hochladen'), { status: 400, expose: true });
    const [{ id }] = await knex('eingangsrechnungen').insert({ quelle: 'upload', dateiname: String(dateiname || 'beleg.pdf').slice(0, 250), mime: m[1], datei: Buffer.from(m[2], 'base64') }).returning('id');
    return markieren(id);
  }

  /** Als Eingangsrechnung markieren und das Auslesen einreihen. */
  async function markieren(id) {
    const n = await knex('eingangsrechnungen').where({ id }).whereIn('status', ['neu', 'verworfen']).update({ status: 'eingang', verarbeitung: 'wartet', verarbeitung_hinweis: null });
    if (!n) throw Object.assign(new Error('Beleg nicht gefunden oder schon markiert'), { status: 404, expose: true });
    einreihen(id);
    return knex('eingangsrechnungen').where({ id }).first('id', 'status', 'verarbeitung');
  }

  function einreihen(id) {
    warteschlange = warteschlange.then(() => auslesen(id)).catch((e) => console.error('Rechnungseingang:', e.message));
    return warteschlange;
  }

  /** Beleg mit Gemini auslesen; Kopfdaten setzen und Posten neu verteilen (von Hand geänderte Posten bleiben). */
  async function auslesen(id) {
    const r = await knex('eingangsrechnungen').where({ id }).first();
    if (!r) return;
    const env = await werte();
    const apiKey = process.env.GEMINI_API_KEY; // nur aus der .env, nie aus der Datenbank
    if (!apiKey) {
      await knex('eingangsrechnungen').where({ id }).update({ verarbeitung: 'fehler', verarbeitung_hinweis: 'Kein Gemini-API-Schlüssel in der .env des Servers (GEMINI_API_KEY). Kategorien bitte von Hand zuordnen.' });
      return;
    }
    await knex('eingangsrechnungen').where({ id }).update({ verarbeitung: 'laeuft' });
    const modell = env.GEMINI_MODELL || 'gemini-3.6-flash';
    const sch = schema();
    const parts = [{ text: anfrageText({ absender: r.mail_absender, betreff: r.mail_betreff }) }];
    if (r.datei) parts.push({ inlineData: { mimeType: r.mime || 'application/pdf', data: Buffer.from(r.datei).toString('base64') } });
    const config = { systemInstruction: SYSTEMANWEISUNG, temperature: 0, responseMimeType: 'application/json', responseJsonSchema: sch, thinkingConfig: /gemini-3/.test(modell) ? { thinkingLevel: 'MINIMAL' } : { thinkingBudget: 0 } };
    let ki = null; let fehler = null;
    for (let versuch = 0; versuch < 2 && !ki; versuch++) {
      try {
        const a = await gemini({ model: modell, contents: [{ role: 'user', parts }], config }, apiKey);
        const j = JSON.parse(String(a.text || '').trim().replace(/^```(?:json)?\s*|\s*```$/g, ''));
        if (!schemaPruefen(j, sch).length) ki = j; else fehler = 'Antwort entsprach nicht dem Schema';
      } catch (e) { fehler = `Gemini: ${String(e.message || e).split('\n')[0].slice(0, 200)}`; if (e.status && e.status < 500 && e.status !== 429) break; }
    }
    if (!ki) {
      await knex('eingangsrechnungen').where({ id }).update({ verarbeitung: 'fehler', verarbeitung_hinweis: `${fehler} – Kategorien bitte von Hand zuordnen oder „Neu auslesen“.` });
      return;
    }
    const kopf = kopfAusKi(ki);
    await knex.transaction(async (trx) => {
      const vonHand = await trx('eingangsrechnung_posten').where({ rechnung_id: id, von_hand: true }).first('id');
      if (!vonHand) {
        await trx('eingangsrechnung_posten').where({ rechnung_id: id }).del();
        const posten = postenAusKi(ki, kopf.brutto_cent);
        if (posten.length) await trx('eingangsrechnung_posten').insert(posten.map((p, i) => ({ ...p, rechnung_id: id, pos: i })));
      }
      // Kopfdaten nur füllen, wo noch nichts steht (von Hand Eingetragenes bleibt)
      const upd = Object.fromEntries(Object.entries(kopf).filter(([k, v]) => v != null && r[k] == null));
      await trx('eingangsrechnungen').where({ id }).update({ ...upd, ki_modell: modell, verarbeitung: 'fertig', verarbeitung_hinweis: vonHand ? 'Posten wurden von Hand bearbeitet und nicht überschrieben.' : null });
    });
  }

  async function liste({ status } = {}) {
    const q = knex('eingangsrechnungen as e')
      .select('e.id', 'e.status', 'e.verarbeitung', 'e.verarbeitung_hinweis', 'e.quelle', 'e.mail_absender', 'e.mail_betreff', 'e.empfangen_am', 'e.dateiname',
        'e.lieferant', 'e.rechnungsnummer', 'e.rechnungsdatum', 'e.faellig_am', 'e.bezahlt_am', 'e.brutto_cent', 'e.beschreibung')
      .select(knex.raw("coalesce((select json_agg(json_build_object('kategorie', p.kategorie, 'betrag_cent', p.betrag_cent)) from eingangsrechnung_posten p where p.rechnung_id = e.id), '[]') as kategorien"))
      .orderBy('e.empfangen_am', 'desc').orderBy('e.id', 'desc');
    if (status) q.whereIn('e.status', [].concat(status));
    return q;
  }

  async function einzeln(id) {
    const r = await knex('eingangsrechnungen').where({ id }).first();
    if (!r) return null;
    delete r.datei;
    r.posten = await knex('eingangsrechnung_posten').where({ rechnung_id: id }).orderBy('pos').orderBy('id');
    return r;
  }

  async function datei(id) { return knex('eingangsrechnungen').where({ id }).first('dateiname', 'mime', 'datei'); }

  const KOPF = ['lieferant', 'rechnungsnummer', 'rechnungsdatum', 'faellig_am', 'bezahlt_am', 'brutto_cent', 'beschreibung'];
  async function aendern(id, daten) {
    const upd = Object.fromEntries(KOPF.filter((k) => k in (daten ?? {})).map((k) => [k, daten[k] === '' ? null : daten[k]]));
    if ('status' in (daten ?? {})) {
      if (!['neu', 'eingang', 'bezahlt', 'verworfen'].includes(daten.status)) throw Object.assign(new Error('Unbekannter Status'), { status: 400, expose: true });
      upd.status = daten.status;
      if (daten.status === 'bezahlt' && !upd.bezahlt_am) upd.bezahlt_am = knex.raw('coalesce(bezahlt_am, current_date)');
      if (daten.status === 'eingang') upd.bezahlt_am = null;
    }
    if (Object.keys(upd).length) await knex('eingangsrechnungen').where({ id }).update(upd);
    return einzeln(id);
  }

  /** Posten von Hand setzen (ersetzt alle); Summe muss nicht zum Bruttobetrag passen, die Oberfläche zeigt die Differenz. */
  async function postenSetzen(id, posten) {
    if (!Array.isArray(posten)) throw Object.assign(new Error('Posten fehlen'), { status: 400, expose: true });
    const zeilen = posten.map((p, i) => {
      if (!KATEGORIE_NAMEN.includes(p.kategorie)) throw Object.assign(new Error(`Unbekannte Kategorie ${p.kategorie}`), { status: 400, expose: true });
      if (!Number.isInteger(p.betrag_cent)) throw Object.assign(new Error('Betrag fehlt'), { status: 400, expose: true });
      return { rechnung_id: id, pos: i, beschreibung: String(p.beschreibung || 'Position').slice(0, 250), betrag_cent: p.betrag_cent, kategorie: p.kategorie, von_hand: true };
    });
    await knex.transaction(async (trx) => {
      await trx('eingangsrechnung_posten').where({ rechnung_id: id }).del();
      if (zeilen.length) await trx('eingangsrechnung_posten').insert(zeilen);
      await trx('eingangsrechnungen').where({ id, verarbeitung: 'fehler' }).update({ verarbeitung: 'fertig', verarbeitung_hinweis: null }); // von Hand zugeordnet
    });
    return einzeln(id);
  }

  async function neuAuslesen(id) {
    await knex('eingangsrechnung_posten').where({ rechnung_id: id }).del();
    await knex('eingangsrechnungen').where({ id }).update({ verarbeitung: 'wartet', verarbeitung_hinweis: null, lieferant: null, rechnungsnummer: null, rechnungsdatum: null, faellig_am: null, brutto_cent: null, ust_cent: null, beschreibung: null });
    einreihen(id);
    return einzeln(id);
  }

  /**
   * EÜR-Ausgaben eines Jahres je Kategorie. Es gilt das Abflussprinzip (§ 11 EStG): maßgeblich ist das Zahlungsdatum,
   * solange keins eingetragen ist, das Rechnungsdatum (bzw. Eingangsdatum).
   */
  async function euer(jahr) {
    const datum = knex.raw('coalesce(e.bezahlt_am, e.rechnungsdatum, e.empfangen_am::date)');
    const zeilen = await knex('eingangsrechnung_posten as p').join('eingangsrechnungen as e', 'e.id', 'p.rechnung_id')
      .whereIn('e.status', ['eingang', 'bezahlt']).whereRaw('extract(year from ?) = ?', [datum, jahr])
      .groupBy('p.kategorie').select('p.kategorie').sum({ summe_cent: 'p.betrag_cent' }).count({ anzahl: '*' });
    const ohne = await knex('eingangsrechnungen as e').whereIn('e.status', ['eingang', 'bezahlt']).whereRaw('extract(year from ?) = ?', [datum, jahr])
      .whereNotExists(knex('eingangsrechnung_posten as p').whereRaw('p.rechnung_id = e.id')).count({ n: '*' }).first();
    const summe = Object.fromEntries(zeilen.map((z) => [z.kategorie, { summe_cent: Number(z.summe_cent), anzahl: Number(z.anzahl) }]));
    return {
      jahr, ohne_kategorie: Number(ohne.n),
      kategorien: KATEGORIE_NAMEN.map((k) => ({ kategorie: k, summe_cent: summe[k]?.summe_cent ?? 0, anzahl: summe[k]?.anzahl ?? 0 })),
      gesamt_cent: zeilen.reduce((a, z) => a + Number(z.summe_cent), 0),
    };
  }

  async function zaehler() {
    const r = await knex('eingangsrechnungen').where({ status: 'neu' }).count({ n: '*' }).first();
    return Number(r.n);
  }

  /** Postfach alle 30 Minuten abrufen, wenn eingerichtet; beim Start hängengebliebene Aufträge wieder einreihen. */
  function starteZeitplan() {
    knex('eingangsrechnungen').whereIn('verarbeitung', ['wartet', 'laeuft']).pluck('id').then((ids) => ids.forEach(einreihen)).catch(() => {});
    const lauf = async () => {
      const env = await werte();
      if (!env.RECHNUNG_IMAP_HOST) return;
      try { const { neu } = await postfach(); if (neu) console.log(`Rechnungspostfach: ${neu} neue Belege`); } catch (e) { console.error('Rechnungspostfach:', e.message); }
    };
    const t = setInterval(lauf, 30 * 60 * 1000); t.unref();
    lauf();
    return { stopp: () => clearInterval(t) };
  }

  const testen = async () => (io.postfachTest ?? postfachTesten)(await werte());

  return { testen, postfach, mailsUebernehmen, hochladen, markieren, auslesen, liste, einzeln, datei, aendern, postenSetzen, neuAuslesen, euer, zaehler, starteZeitplan, warten: () => warteschlange };
}
