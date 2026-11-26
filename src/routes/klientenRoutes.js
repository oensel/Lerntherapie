import { Router } from 'express';

const FELDER = ['vorname', 'nachname', 'geburtsdatum', 'schule', 'klasse', 'schwerpunkt',
  'kostentraeger', 'sorgeberechtigte', 'email', 'telefon', 'adresse', 'notizen', 'aktiv',
  'geburtsjahr', 'aufnahme_datum', 'material_noetig', 'material_versandt_am', 'material_versand_art'];
const KOSTENTRAEGER = ['eltern', 'jugendamt'];

function auswahl(body) {
  return Object.fromEntries(FELDER.filter((f) => f in body).map((f) => [f, body[f]]));
}

export function getKlientenRoutes(knex) {
  const r = Router();

  r.get('/', async (req, res) => {
    const q = knex('klienten').orderBy(['nachname', 'vorname']);
    if (req.query.archiv !== 'true') q.where({ aktiv: true });
    res.json(await q);
  });

  r.get('/:id', async (req, res) => {
    const k = await knex('klienten').where({ id: req.params.id }).first();
    if (!k) return res.status(404).json({ fehler: 'Klient nicht gefunden' });
    res.json(k);
  });

  r.post('/', async (req, res) => {
    if (!req.body?.vorname || !req.body?.nachname) return res.status(400).json({ fehler: 'Vor- und Nachname fehlen' });
    if (req.body.kostentraeger && !KOSTENTRAEGER.includes(req.body.kostentraeger)) return res.status(400).json({ fehler: 'Unbekannter Kostenträger' });
    const [k] = await knex('klienten').insert(auswahl(req.body)).returning('*');
    res.status(201).json(k);
  });

  r.put('/:id', async (req, res) => {
    const [k] = await knex('klienten').where({ id: req.params.id })
      .update({ ...auswahl(req.body ?? {}), aktualisiert_am: knex.fn.now() }).returning('*');
    if (!k) return res.status(404).json({ fehler: 'Klient nicht gefunden' });
    res.json(k);
  });

  return r;
}
