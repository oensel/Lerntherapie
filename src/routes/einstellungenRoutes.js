import { Router } from 'express';

const SAETZE = ['stundensatz_cent', 'ausfall_cent', 'unentschuldigt_cent'];

// Allgemeine Abrechnungssätze (Standard für alle Klienten ohne eigenen Wert)
export function getEinstellungenRoutes(knex) {
  const r = Router();

  r.get('/', async (_req, res) => res.json(await knex('einstellungen').where({ id: 1 }).first()));

  r.put('/', async (req, res) => {
    const daten = {};
    if ('autoversand' in (req.body ?? {})) daten.autoversand = req.body.autoversand === true;
    for (const f of SAETZE) {
      if (!(f in (req.body ?? {}))) continue;
      const v = req.body[f];
      if (!Number.isInteger(v) || v < 0) return res.status(400).json({ fehler: 'Beträge als ganze Cent ≥ 0 angeben' });
      daten[f] = v;
    }
    const [e] = await knex('einstellungen').where({ id: 1 }).update({ ...daten, aktualisiert_am: knex.fn.now() }).returning('*');
    res.json(e);
  });

  return r;
}
