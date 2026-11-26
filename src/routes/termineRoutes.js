import { Router } from 'express';

const FELDER = ['klient_id', 'beginn', 'ende', 'art', 'status', 'ort', 'notiz', 'dokumentation'];
export const STATUS = ['geplant', 'stattgefunden', 'abgesagt', 'ausgefallen', 'unentschuldigt'];
const pruefe = (b) => (b.status && !STATUS.includes(b.status) ? 'Unbekannter Status'
  : b.beginn && b.ende && new Date(b.ende) <= new Date(b.beginn) ? 'Ende muss nach dem Beginn liegen' : null);
const auswahl = (b) => Object.fromEntries(FELDER.filter((f) => f in b).map((f) => [f, b[f]]));

export function getTermineRoutes(knex) {
  const r = Router();

  // ?von=2026-12-01&bis=2026-12-31
  r.get('/', async (req, res) => {
    const q = knex('termine').leftJoin('klienten', 'klienten.id', 'termine.klient_id')
      .select('termine.*', 'klienten.vorname', 'klienten.nachname').orderBy('beginn');
    if (req.query.von) q.where('beginn', '>=', req.query.von);
    if (req.query.bis) q.where('beginn', '<', req.query.bis);
    if (req.query.klient) q.where('termine.klient_id', req.query.klient);
    res.json(await q);
  });

  r.post('/', async (req, res) => {
    if (!req.body?.beginn || !req.body?.ende) return res.status(400).json({ fehler: 'Beginn und Ende fehlen' });
    const f = pruefe(req.body);
    if (f) return res.status(400).json({ fehler: f });
    const [t] = await knex('termine').insert(auswahl(req.body)).returning('*');
    res.status(201).json(t);
  });

  r.put('/:id', async (req, res) => {
    const f = pruefe(req.body ?? {});
    if (f) return res.status(400).json({ fehler: f });
    const [t] = await knex('termine').where({ id: req.params.id })
      .update({ ...auswahl(req.body ?? {}), aktualisiert_am: knex.fn.now() }).returning('*');
    if (!t) return res.status(404).json({ fehler: 'Termin nicht gefunden' });
    res.json(t);
  });

  r.delete('/:id', async (req, res) => {
    const n = await knex('termine').where({ id: req.params.id }).del();
    res.status(n ? 204 : 404).end();
  });

  return r;
}
