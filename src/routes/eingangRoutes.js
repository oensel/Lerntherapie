import { Router } from 'express';
import { KATEGORIEN } from '../services/eingangLogik.js';

// Rechnungseingang: Postfach, Markieren als Eingangsrechnung, Posten/Kategorien, EÜR-Übersicht
export function getEingangRoutes(dienst) {
  const r = Router();
  const id = (req) => Number(req.params.id);

  r.get('/', async (req, res) => res.json(await dienst.liste({ status: req.query.status ? String(req.query.status).split(',') : undefined })));
  r.get('/kategorien', (_req, res) => res.json(KATEGORIEN.map(([name, beschreibung]) => ({ name, beschreibung }))));
  r.get('/zaehler', async (_req, res) => res.json({ neu: await dienst.zaehler() }));
  r.get('/euer', async (req, res) => res.json(await dienst.euer(Number(req.query.jahr) || new Date().getFullYear())));
  r.post('/abruf', async (_req, res) => {
    try { res.json(await dienst.postfach()); } catch (e) {
      if (e.expose) throw e;
      res.status(502).json({ fehler: `Postfach-Abruf fehlgeschlagen: ${e.message}` });
    }
  });
  r.post('/postfach-test', async (_req, res) => {
    try { res.json(await dienst.testen()); } catch (e) {
      if (e.expose) throw e;
      res.status(502).json({ fehler: `Verbindung fehlgeschlagen: ${e.responseText || e.message}` });
    }
  });
  r.post('/upload', async (req, res) => res.status(201).json(await dienst.hochladen(req.body ?? {})));

  r.get('/:id', async (req, res) => { const e = await dienst.einzeln(id(req)); if (!e) return res.status(404).json({ fehler: 'Nicht gefunden' }); res.json(e); });
  r.get('/:id/datei', async (req, res) => {
    const d = await dienst.datei(id(req));
    if (!d?.datei) return res.status(404).end();
    res.type(d.mime || 'application/pdf').set('content-disposition', `inline; filename="${encodeURIComponent(d.dateiname || 'beleg.pdf')}"`).send(d.datei);
  });
  r.post('/:id/markieren', async (req, res) => res.json(await dienst.markieren(id(req))));
  r.post('/:id/auslesen', async (req, res) => res.json(await dienst.neuAuslesen(id(req))));
  r.put('/:id', async (req, res) => res.json(await dienst.aendern(id(req), req.body)));
  r.put('/:id/posten', async (req, res) => res.json(await dienst.postenSetzen(id(req), req.body?.posten)));
  return r;
}
