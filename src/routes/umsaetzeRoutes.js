import { Router } from 'express';

export function getUmsaetzeRoutes(knex, umsatzDienst) {
  const r = Router();

  // ?von=YYYY-MM-DD&bis=YYYY-MM-DD&nur=eingang|ausgang&suche=text
  r.get('/', async (req, res) => {
    const q = knex('umsaetze').orderBy([{ column: 'buchungsdatum', order: 'desc' }, { column: 'id', order: 'desc' }]).limit(500);
    if (req.query.von) q.where('buchungsdatum', '>=', req.query.von);
    if (req.query.bis) q.where('buchungsdatum', '<=', req.query.bis);
    if (req.query.nur === 'eingang') q.where('betrag_cent', '>', 0);
    if (req.query.nur === 'ausgang') q.where('betrag_cent', '<', 0);
    if (req.query.suche) {
      const s = `%${req.query.suche}%`;
      q.where((w) => w.whereILike('gegen_name', s).orWhereILike('verwendungszweck', s));
    }
    res.json(await q);
  });

  // Anzahl ungesehener Umsätze für den Zähler in der Navigation, plus Abrufstatus
  r.get('/status', async (_req, res) => {
    const [{ anzahl }] = await knex('umsaetze').where({ gesehen: false }).count({ anzahl: '*' });
    const z = await knex('fints_zustand').where({ id: 1 })
      .first('letzter_abruf', 'letzter_erfolg', 'letzter_fehler', 'freigabe_noetig');
    res.json({ neu: Number(anzahl), laeuft: umsatzDienst.laeuft(), ...z });
  });

  // Alle bisher ungesehenen als gesehen markieren (beim Öffnen der Seite „Umsätze“)
  r.post('/gesehen', async (_req, res) => {
    const n = await knex('umsaetze').where({ gesehen: false }).update({ gesehen: true });
    res.json({ markiert: n });
  });

  // Manueller Abruf; läuft im Hintergrund, weil eine pushTAN-Freigabe bis zu 5 Minuten dauern kann
  r.post('/abruf', (_req, res) => {
    umsatzDienst.starteAbruf('manuell').catch(() => {});
    res.status(202).json({ gestartet: true });
  });

  return r;
}
