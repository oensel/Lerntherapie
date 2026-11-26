import { Router } from 'express';
import { erstelleRechnungPdf } from '../services/rechnungPdf.js';
import { vormonat } from '../services/rechnungsLogik.js';

const MONAT = /^\d{4}-(0[1-9]|1[0-2])$/;

export function getRechnungenRoutes(knex, dienst) {
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
    res.json({ monat, liste: liste.map(({ klient, ...v }) => v) });
  });

  // Manueller Lauf: { monat, klient_ids? }
  r.post('/lauf', async (req, res) => {
    const monat = req.body?.monat || vormonat();
    if (!MONAT.test(monat)) return res.status(400).json({ fehler: 'Monat im Format JJJJ-MM angeben' });
    const erstellt = await dienst.lauf(monat, { klientIds: req.body?.klient_ids });
    res.status(201).json({ erstellt });
  });

  r.post('/abgleich', async (_req, res) => res.json({ bezahlt: await dienst.abgleichen() }));

  r.get('/:id', async (req, res) => {
    const re = await knex('rechnungen').where({ id: req.params.id }).first();
    if (!re) return res.status(404).json({ fehler: 'Rechnung nicht gefunden' });
    re.positionen = await knex('rechnungspositionen').where({ rechnung_id: re.id }).orderBy(['datum', 'id']);
    res.json(re);
  });

  r.get('/:id/pdf', async (req, res) => {
    const re = await knex('rechnungen').where({ id: req.params.id }).first();
    if (!re) return res.status(404).json({ fehler: 'Rechnung nicht gefunden' });
    const pos = await knex('rechnungspositionen').where({ rechnung_id: re.id }).orderBy(['datum', 'id']);
    const pdf = await erstelleRechnungPdf(re, pos);
    res.type('application/pdf').set('content-disposition', `inline; filename="Rechnung-${re.nummer}.pdf"`).send(Buffer.from(pdf));
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
