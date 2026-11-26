import { Router } from 'express';
import { monatsSummen, kontoverlauf } from '../services/umsatzAuswertung.js';

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
      .first('letzter_abruf', 'letzter_erfolg', 'letzter_fehler', 'freigabe_noetig', 'saldo_cent', 'saldo_datum');
    const [{ erster }] = await knex('umsaetze').min({ erster: 'buchungsdatum' });
    res.json({ neu: Number(anzahl), laeuft: umsatzDienst.laeuft(), ...z, saldo_cent: z?.saldo_cent == null ? null : Number(z.saldo_cent), erster_umsatz: erster });
  });

  // Alle bisher ungesehenen als gesehen markieren (beim Öffnen der Seite „Umsätze“)
  r.post('/gesehen', async (_req, res) => {
    const n = await knex('umsaetze').where({ gesehen: false }).update({ gesehen: true });
    res.json({ markiert: n });
  });

  // Ein- und Ausgaben je Monat und Kontoverlauf über alle gespeicherten Umsätze
  r.get('/auswertung', async (_req, res) => {
    const umsaetze = await knex('umsaetze').select('buchungsdatum', 'betrag_cent').orderBy('buchungsdatum');
    const z = await knex('fints_zustand').where({ id: 1 }).first('saldo_cent', 'saldo_datum');
    res.json({ monate: monatsSummen(umsaetze), verlauf: kontoverlauf(umsaetze, z?.saldo_cent, z?.saldo_datum) });
  });

  // Manueller Abruf (?voll=1: alles, was die Bank vorhält); läuft im Hintergrund, weil eine pushTAN-Freigabe bis zu 5 Minuten dauern kann
  r.post('/abruf', (req, res) => {
    umsatzDienst.starteAbruf('manuell', { voll: req.query.voll === '1' }).catch(() => {});
    res.status(202).json({ gestartet: true });
  });

  return r;
}
