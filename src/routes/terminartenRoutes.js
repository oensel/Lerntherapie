import { Router } from 'express';

// Terminarten mit üblicher Dauer und Beträgen je Ergebnis (stattgefunden = Preis für die übliche Dauer, Ausfall < 24 h,
// Nichterscheinen). Entfernen löscht, solange kein Termin die Art nutzt; sonst wird sie nur ausgeblendet (aktiv=false).
const BETRAEGE = ['preis_cent', 'ausfall_cent', 'unentschuldigt_cent'];
const pruefe = (b) => {
  if (!String(b?.name ?? '').trim()) return 'Name fehlt';
  if (!Number.isInteger(b.dauer_min) || b.dauer_min < 5 || b.dauer_min > 600) return 'Übliche Dauer in Minuten (5 bis 600) angeben';
  if (BETRAEGE.some((f) => !Number.isInteger(b[f]) || b[f] < 0)) return 'Beträge als ganze Cent ≥ 0 angeben';
  return null;
};
const daten = (b) => ({ name: String(b.name).trim().slice(0, 100), dauer_min: b.dauer_min, ...Object.fromEntries(BETRAEGE.map((f) => [f, b[f]])) });

export function getTerminartenRoutes(knex) {
  const r = Router();
  r.get('/', async (req, res) => {
    const q = knex('terminarten').orderBy('sortierung').orderBy('id');
    if (!req.query.alle) q.where({ aktiv: true });
    res.json(await q);
  });
  r.post('/', async (req, res) => {
    const f = pruefe(req.body);
    if (f) return res.status(400).json({ fehler: f });
    const { max } = await knex('terminarten').max({ max: 'sortierung' }).first();
    const [a] = await knex('terminarten').insert({ sortierung: (max ?? 0) + 1, ...daten(req.body) }).returning('*');
    res.status(201).json(a);
  });
  // Änderungen gelten für neue Termine; bestehende behalten Dauer und Beträge, die beim Anlegen galten
  r.put('/:id', async (req, res) => {
    const f = pruefe(req.body);
    if (f) return res.status(400).json({ fehler: f });
    const [a] = await knex('terminarten').where({ id: req.params.id }).update(daten(req.body)).returning('*');
    if (!a) return res.status(404).json({ fehler: 'Terminart nicht gefunden' });
    res.json(a);
  });
  r.delete('/:id', async (req, res) => {
    const { n: aktive } = await knex('terminarten').where({ aktiv: true }).count({ n: '*' }).first();
    if (Number(aktive) <= 1) return res.status(409).json({ fehler: 'Die letzte Terminart kann nicht entfernt werden' });
    const genutzt = await knex('termine').where({ terminart_id: req.params.id }).first('id');
    const n = genutzt ? await knex('terminarten').where({ id: req.params.id }).update({ aktiv: false }) : await knex('terminarten').where({ id: req.params.id }).del();
    res.status(n ? 204 : 404).end();
  });
  return r;
}
