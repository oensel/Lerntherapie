import { Router } from 'express';

const FELDER = ['klient_id', 'therapie_id', 'terminart_id', 'beginn', 'ende', 'art', 'status', 'ort', 'notiz', 'dokumentation'];
export const STATUS = ['geplant', 'stattgefunden', 'abgesagt', 'ausgefallen', 'unentschuldigt'];
const pruefe = (b) => (b.status && !STATUS.includes(b.status) ? 'Unbekannter Status'
  : b.beginn && b.ende && new Date(b.ende) <= new Date(b.beginn) ? 'Ende muss nach dem Beginn liegen' : null);
const auswahl = (b) => Object.fromEntries(FELDER.filter((f) => f in b).map((f) => [f, b[f]]));

// Terminart übernehmen: Name, geplante Dauer und Preis werden am Termin eingefroren (null = ohne Art)
async function mitArt(knex, daten) {
  if (!('terminart_id' in daten)) return daten;
  if (!daten.terminart_id) return { ...daten, terminart_id: null, terminart_name: null, geplante_dauer_min: null, preis_cent: null, ausfall_cent: null, unentschuldigt_cent: null };
  const a = await knex('terminarten').where({ id: daten.terminart_id }).first();
  if (!a) throw Object.assign(new Error('Unbekannte Terminart'), { status: 400, expose: true });
  return { ...daten, terminart_name: a.name, geplante_dauer_min: a.dauer_min, preis_cent: a.preis_cent, ausfall_cent: a.ausfall_cent, unentschuldigt_cent: a.unentschuldigt_cent };
}

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
    const daten = await mitArt(knex, auswahl(req.body));
    // Ohne Angabe: erste aktive Therapie des Klienten
    if (!daten.therapie_id && daten.klient_id) {
      daten.therapie_id = (await knex('therapien').where({ klient_id: daten.klient_id, aktiv: true }).orderBy('id').first('id'))?.id ?? null;
    }
    const [t] = await knex('termine').insert(daten).returning('*');
    res.status(201).json(t);
  });

  r.put('/:id', async (req, res) => {
    const f = pruefe(req.body ?? {});
    if (f) return res.status(400).json({ fehler: f });
    const [t] = await knex('termine').where({ id: req.params.id })
      .update({ ...(await mitArt(knex, auswahl(req.body ?? {}))), aktualisiert_am: knex.fn.now() }).returning('*');
    if (!t) return res.status(404).json({ fehler: 'Termin nicht gefunden' });
    res.json(t);
  });

  r.delete('/:id', async (req, res) => {
    const n = await knex('termine').where({ id: req.params.id }).del();
    res.status(n ? 204 : 404).end();
  });

  return r;
}
