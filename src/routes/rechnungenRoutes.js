import { Router } from 'express';
import { erstelleMahnungPdf, praxisAusEnv } from '../services/rechnungPdf.js';
import { vormonat, MAHNSTUFEN, mahnEinstellungen, rechnungsVerlauf } from '../services/rechnungsLogik.js';
import { entwurfMahnung } from '../services/mailDienst.js';

const MONAT = /^\d{4}-(0[1-9]|1[0-2])$/;

export function getRechnungenRoutes(knex, dienst, mail, werte = async () => process.env, versand) {
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

  // Rechnungsausgang: geprüfte Rechnungen gesammelt mit dem Standardtext senden { ids: [...] }
  r.post('/versand', async (req, res) => {
    const ids = (req.body?.ids ?? []).map(Number).filter(Number.isInteger);
    if (!ids.length) return res.status(400).json({ fehler: 'Keine Rechnungen ausgewählt' });
    res.json(await versand.sammelVersand(ids));
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

  // PDF und Daten einer Mahnung (für Anzeige und Versand); Rechnungen über den Versanddienst
  const rechnungsDokument = versand.dokument;
  async function mahnungsDokument(mid) {
    const m = await knex('mahnungen').where({ id: mid }).first();
    if (!m) return null;
    const re = await knex('rechnungen').where({ id: m.rechnung_id }).first();
    const [{ s }] = await knex('mahnungen').where({ rechnung_id: re.id }).where('stufe', '<=', m.stufe).sum({ s: 'gebuehr_cent' });
    const art = MAHNSTUFEN[m.stufe], gebuehren = Number(s || 0);
    return { m, re, art, offen: re.betrag_cent + gebuehren, name: `${art.replace(/ /g, '-')}-${re.nummer}.pdf`, pdf: await erstelleMahnungPdf(re, m, gebuehren, art, await praxisDaten()) };
  }
  const sendePdf = (res, d) => res.type('application/pdf').set('content-disposition', `inline; filename="${d.name}"`).send(Buffer.from(d.pdf));
  const empfaengerMail = versand.empfaengerMail;
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
    re.verlauf = rechnungsVerlauf(re, re.mahnungen, re.versand, mahnEinstellungen(await werte()));
    res.json(re);
  });

  r.get('/:id/pdf', async (req, res) => {
    const d = await rechnungsDokument(req.params.id);
    if (!d) return res.status(404).json({ fehler: 'Rechnung nicht gefunden' });
    sendePdf(res, d);
  });

  r.get('/:id/versand', async (req, res) => {
    const e = await versand.entwurf(req.params.id);
    if (!e) return res.status(404).json({ fehler: 'Rechnung nicht gefunden' });
    res.json(e);
  });

  r.post('/:id/versand', async (req, res) => {
    const f = pruefeVersand(req.body);
    if (f) return res.status(400).json({ fehler: f });
    res.json(await versand.senden(req.params.id, req.body));
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
