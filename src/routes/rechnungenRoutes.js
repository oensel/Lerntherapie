import { Router } from 'express';
import { erstelleRechnungPdf, erstelleMahnungPdf, praxisAusEnv } from '../services/rechnungPdf.js';
import { vormonat, MAHNSTUFEN } from '../services/rechnungsLogik.js';
import { entwurfRechnung, entwurfMahnung } from '../services/mailDienst.js';

const MONAT = /^\d{4}-(0[1-9]|1[0-2])$/;

export function getRechnungenRoutes(knex, dienst, mail, werte = async () => process.env) {
  const praxisDaten = async () => praxisAusEnv(await werte());
  const r = Router();

  // ?klient=ID&status=offen|bezahlt|storniert
  r.get('/', async (req, res) => {
    const q = knex('rechnungen').orderBy('nummer', 'desc');
    if (req.query.klient) q.where({ klient_id: req.query.klient });
    if (req.query.status) q.where({ status: req.query.status });
    res.json(await q);
  });

  // Vorschau für ?monat=YYYY-MM (Standard: Vormonat)
  r.get('/vorschau', async (req, res) => {
    const monat = req.query.monat || vormonat();
    if (!MONAT.test(monat)) return res.status(400).json({ fehler: 'Monat im Format JJJJ-MM angeben' });
    const liste = await dienst.vorschau(monat);
    res.json({ monat, liste: liste.map(({ zahler, ...v }) => v) });
  });

  // Manueller Lauf: { monat, klient_ids? }
  r.post('/lauf', async (req, res) => {
    const monat = req.body?.monat || vormonat();
    if (!MONAT.test(monat)) return res.status(400).json({ fehler: 'Monat im Format JJJJ-MM angeben' });
    const erstellt = await dienst.lauf(monat, { klientIds: req.body?.klient_ids, therapieIds: req.body?.therapie_ids });
    res.status(201).json({ erstellt });
  });

  r.post('/abgleich', async (_req, res) => res.json({ bezahlt: await dienst.abgleichen() }));

  // Mahnwesen
  r.get('/mahnungen/faellig', async (_req, res) => {
    res.json((await dienst.faelligeMahnungen()).map(({ rechnung, stufe }) => ({ ...rechnung, faellige_stufe: stufe, faellige_art: MAHNSTUFEN[stufe] })));
  });

  r.post('/:id/mahnung', async (req, res) => {
    const m = await dienst.mahnen(req.params.id, { erzwingen: req.body?.erzwingen === true });
    if (!m) return res.status(409).json({ fehler: 'Keine Mahnung fällig (bezahlt, storniert, Frist läuft noch oder Stufe 3 erreicht)' });
    res.status(201).json(m);
  });

  // PDF und Daten einer Rechnung bzw. Mahnung (für Anzeige und Versand)
  async function rechnungsDokument(id) {
    const re = await knex('rechnungen').where({ id }).first();
    if (!re) return null;
    const pos = await knex('rechnungspositionen').where({ rechnung_id: re.id }).orderBy(['datum', 'id']);
    return { re, name: `Rechnung-${re.nummer}.pdf`, pdf: await erstelleRechnungPdf(re, pos, await praxisDaten()) };
  }
  async function mahnungsDokument(mid) {
    const m = await knex('mahnungen').where({ id: mid }).first();
    if (!m) return null;
    const re = await knex('rechnungen').where({ id: m.rechnung_id }).first();
    const [{ s }] = await knex('mahnungen').where({ rechnung_id: re.id }).where('stufe', '<=', m.stufe).sum({ s: 'gebuehr_cent' });
    const art = MAHNSTUFEN[m.stufe], gebuehren = Number(s || 0);
    return { m, re, art, offen: re.betrag_cent + gebuehren, name: `${art.replace(/ /g, '-')}-${re.nummer}.pdf`, pdf: await erstelleMahnungPdf(re, m, gebuehren, art, await praxisDaten()) };
  }
  const sendePdf = (res, d) => res.type('application/pdf').set('content-disposition', `inline; filename="${d.name}"`).send(Buffer.from(d.pdf));
  // Adresse des Zahlers (aktuell, sonst die bei Erstellung gespeicherte), notfalls die des Klienten
  const empfaengerMail = async (re) => (re.zahler_id && (await knex('zahler').where({ id: re.zahler_id }).first('email'))?.email)
    || re.empfaenger_email || (await knex('klienten').where({ id: re.klient_id }).first('email'))?.email || '';
  const pruefeVersand = (b) => (!b?.an || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(b.an) ? 'Gültige E-Mail-Adresse angeben'
    : !b.betreff?.trim() || !b.text?.trim() ? 'Betreff und Text dürfen nicht leer sein' : null);

  r.get('/mahnungen/:mid/pdf', async (req, res) => {
    const d = await mahnungsDokument(req.params.mid);
    if (!d) return res.status(404).json({ fehler: 'Mahnung nicht gefunden' });
    sendePdf(res, d);
  });

  // E-Mail-Versand: GET liefert den Entwurf, POST { an, betreff, text } sendet mit PDF im Anhang
  r.get('/mahnungen/:mid/versand', async (req, res) => {
    const d = await mahnungsDokument(req.params.mid);
    if (!d) return res.status(404).json({ fehler: 'Mahnung nicht gefunden' });
    res.json({ an: await empfaengerMail(d.re), ...entwurfMahnung(d.re, d.m, d.art, d.offen, (await praxisDaten()).name), eingerichtet: await mail.eingerichtet() });
  });

  r.post('/mahnungen/:mid/versand', async (req, res) => {
    const f = pruefeVersand(req.body);
    if (f) return res.status(400).json({ fehler: f });
    const d = await mahnungsDokument(req.params.mid);
    if (!d) return res.status(404).json({ fehler: 'Mahnung nicht gefunden' });
    await mail.sende({ ...req.body, anhang: { name: d.name, daten: d.pdf }, rechnung_id: d.re.id, mahnung_id: d.m.id });
    const [m] = await knex('mahnungen').where({ id: d.m.id }).update({ versendet_am: knex.fn.now() }).returning('*');
    res.json(m);
  });

  r.get('/:id', async (req, res) => {
    const re = await knex('rechnungen').where({ id: req.params.id }).first();
    if (!re) return res.status(404).json({ fehler: 'Rechnung nicht gefunden' });
    re.positionen = await knex('rechnungspositionen').where({ rechnung_id: re.id }).orderBy(['datum', 'id']);
    re.mahnungen = (await knex('mahnungen').where({ rechnung_id: re.id }).orderBy('stufe')).map((m) => ({ ...m, art: MAHNSTUFEN[m.stufe] }));
    re.versand = await knex('mail_versand').where({ rechnung_id: re.id }).orderBy('gesendet_am', 'desc');
    res.json(re);
  });

  r.get('/:id/pdf', async (req, res) => {
    const d = await rechnungsDokument(req.params.id);
    if (!d) return res.status(404).json({ fehler: 'Rechnung nicht gefunden' });
    sendePdf(res, d);
  });

  r.get('/:id/versand', async (req, res) => {
    const d = await rechnungsDokument(req.params.id);
    if (!d) return res.status(404).json({ fehler: 'Rechnung nicht gefunden' });
    res.json({ an: await empfaengerMail(d.re), ...entwurfRechnung(d.re, (await praxisDaten()).name), eingerichtet: await mail.eingerichtet() });
  });

  r.post('/:id/versand', async (req, res) => {
    const f = pruefeVersand(req.body);
    if (f) return res.status(400).json({ fehler: f });
    const d = await rechnungsDokument(req.params.id);
    if (!d) return res.status(404).json({ fehler: 'Rechnung nicht gefunden' });
    if (d.re.status === 'storniert') return res.status(409).json({ fehler: 'Stornierte Rechnungen werden nicht versendet' });
    await mail.sende({ ...req.body, anhang: { name: d.name, daten: d.pdf }, rechnung_id: d.re.id });
    const [re] = await knex('rechnungen').where({ id: d.re.id }).update({ versendet_am: knex.fn.now() }).returning('*');
    res.json(re);
  });

  // Manuell als bezahlt / wieder offen markieren: { status: 'bezahlt'|'offen', bezahlt_am? }
  r.put('/:id/status', async (req, res) => {
    const { status, bezahlt_am } = req.body ?? {};
    if (status === 'storniert') {
      const re = await dienst.stornieren(req.params.id);
      return re ? res.json(re) : res.status(409).json({ fehler: 'Nur offene Rechnungen können storniert werden' });
    }
    if (!['offen', 'bezahlt'].includes(status)) return res.status(400).json({ fehler: 'Unbekannter Status' });
    const [re] = await knex('rechnungen').where({ id: req.params.id }).whereNot({ status: 'storniert' })
      .update(status === 'bezahlt' ? { status, bezahlt_am: bezahlt_am || knex.fn.now() } : { status, bezahlt_am: null, umsatz_id: null })
      .returning('*');
    if (!re) return res.status(404).json({ fehler: 'Rechnung nicht gefunden oder storniert' });
    res.json(re);
  });

  return r;
}
