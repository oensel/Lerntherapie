import { Router } from 'express';

const ZAHLER_ARTEN = ['eltern', 'jugendamt', 'sonstige'];
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SAETZE = ['stundensatz_cent', 'ausfall_cent', 'unentschuldigt_cent'];
const auswahl = (b, felder) => Object.fromEntries(felder.filter((f) => f in b).map((f) => [f, b[f] === '' ? null : b[f]]));

// Zahler eines Klienten (Eltern, Elternteil, Jugendamt …): GET /api/zahler?klient=ID, POST, PUT /:id, DELETE /:id
export function getZahlerRoutes(knex) {
  const r = Router();
  const FELDER = ['klient_id', 'art', 'name', 'adresse', 'email', 'telefon'];
  const pruefe = (b, neu) => (neu && !b.klient_id ? 'Klient fehlt'
    : (neu || 'name' in b) && !String(b.name ?? '').trim() ? 'Name fehlt'
      : b.art && !ZAHLER_ARTEN.includes(b.art) ? 'Unbekannte Art'
        : b.email && !EMAIL.test(b.email) ? 'E-Mail-Adresse ungültig' : null);

  r.get('/', async (req, res) => {
    const q = knex('zahler').orderBy(['klient_id', 'id']);
    if (req.query.klient) q.where({ klient_id: req.query.klient });
    res.json(await q);
  });
  r.post('/', async (req, res) => {
    const f = pruefe(req.body ?? {}, true);
    if (f) return res.status(400).json({ fehler: f });
    const [z] = await knex('zahler').insert(auswahl(req.body, FELDER)).returning('*');
    res.status(201).json(z);
  });
  r.put('/:id', async (req, res) => {
    const f = pruefe(req.body ?? {}, false);
    if (f) return res.status(400).json({ fehler: f });
    const { klient_id, ...daten } = auswahl(req.body ?? {}, FELDER);
    const [z] = await knex('zahler').where({ id: req.params.id }).update(daten).returning('*');
    if (!z) return res.status(404).json({ fehler: 'Zahler nicht gefunden' });
    res.json(z);
  });
  r.delete('/:id', async (req, res) => {
    const benutzt = await knex('therapien').where({ zahler_id: req.params.id }).first('bezeichnung');
    if (benutzt) return res.status(409).json({ fehler: `Zahler ist der Therapie „${benutzt.bezeichnung}“ zugeordnet` });
    const n = await knex('zahler').where({ id: req.params.id }).del();
    res.status(n ? 204 : 404).end();
  });
  return r;
}

// Therapiearten eines Klienten, jede mit Zahler und optional eigenen Beträgen (NULL = Standard)
export function getTherapienRoutes(knex) {
  const r = Router();
  const FELDER = ['klient_id', 'bezeichnung', 'zahler_id', ...SAETZE, 'aktiv'];
  const pruefe = async (b, neu, klientId) => {
    if (neu && !b.klient_id) return 'Klient fehlt';
    if ((neu || 'bezeichnung' in b) && !String(b.bezeichnung ?? '').trim()) return 'Bezeichnung fehlt';
    for (const s of SAETZE) if (b[s] != null && b[s] !== '' && (!Number.isInteger(b[s]) || b[s] < 0)) return 'Beträge als ganze Cent ≥ 0 angeben';
    if (b.zahler_id) {
      const z = await knex('zahler').where({ id: b.zahler_id }).first('klient_id');
      if (!z || z.klient_id !== Number(klientId ?? b.klient_id)) return 'Zahler gehört nicht zu diesem Klienten';
    }
    return null;
  };

  r.get('/', async (req, res) => {
    const q = knex('therapien').orderBy(['klient_id', 'id']);
    if (req.query.klient) q.where({ klient_id: req.query.klient });
    res.json(await q);
  });
  r.post('/', async (req, res) => {
    const f = await pruefe(req.body ?? {}, true);
    if (f) return res.status(400).json({ fehler: f });
    const [t] = await knex('therapien').insert(auswahl(req.body, FELDER)).returning('*');
    res.status(201).json(t);
  });
  r.put('/:id', async (req, res) => {
    const alt = await knex('therapien').where({ id: req.params.id }).first();
    if (!alt) return res.status(404).json({ fehler: 'Therapie nicht gefunden' });
    const f = await pruefe(req.body ?? {}, false, alt.klient_id);
    if (f) return res.status(400).json({ fehler: f });
    const { klient_id, ...daten } = auswahl(req.body ?? {}, FELDER);
    const [t] = await knex('therapien').where({ id: alt.id }).update(daten).returning('*');
    res.json(t);
  });
  r.delete('/:id', async (req, res) => {
    if (await knex('termine').where({ therapie_id: req.params.id }).first('id')) {
      return res.status(409).json({ fehler: 'Therapie hat Termine – bitte stattdessen beenden (inaktiv setzen)' });
    }
    const n = await knex('therapien').where({ id: req.params.id }).del();
    res.status(n ? 204 : 404).end();
  });
  return r;
}
