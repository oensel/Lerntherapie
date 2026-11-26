import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { knex } from './db.js';
import { getKlientenRoutes } from './routes/klientenRoutes.js';
import { getTermineRoutes } from './routes/termineRoutes.js';
import { getUmsaetzeRoutes } from './routes/umsaetzeRoutes.js';
import { erstelleUmsatzDienst } from './services/umsatzDienst.js';
import { getRechnungenRoutes } from './routes/rechnungenRoutes.js';
import { erstelleRechnungsDienst } from './services/rechnungsDienst.js';
import { erstelleMailDienst } from './services/mailDienst.js';
import { getEinstellungenRoutes } from './routes/einstellungenRoutes.js';
import { getKonfigRoutes } from './routes/konfigRoutes.js';
import { getZahlerRoutes, getTherapienRoutes } from './routes/zahlerTherapienRoutes.js';
import { erstelleKonfigDienst } from './services/konfigDienst.js';
import { erstelleRechnungsVersand } from './services/rechnungsVersand.js';
import { erstelleEingangDienst } from './services/eingangDienst.js';
import { getEingangRoutes } from './routes/eingangRoutes.js';
import { erstelleDatevDienst } from './services/datevDienst.js';
import { getTerminartenRoutes } from './routes/terminartenRoutes.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);

export function erstelleApp(db, {
  konfig = erstelleKonfigDienst(db),
  rechnungsDienst = erstelleRechnungsDienst(db),
  umsatzDienst = erstelleUmsatzDienst(db, { werte: konfig.wirksam, nachAbruf: rechnungsDienst.abgleichen }),
  mailDienst = erstelleMailDienst(db, { werte: konfig.wirksam }),
  eingangDienst = erstelleEingangDienst(db, { werte: konfig.wirksam }),
  rechnungsVersand = erstelleRechnungsVersand(db, mailDienst, { werte: konfig.wirksam }),
} = {}) {
  const app = express();
  app.use(express.json({ limit: '25mb' }));

  app.get('/api/health', async (_req, res) => {
    try {
      await db.raw('select 1');
      res.json({ ok: true, db: true });
    } catch {
      res.status(503).json({ ok: false, db: false });
    }
  });

  app.use('/api/klienten', getKlientenRoutes(db));
  app.use('/api/termine', getTermineRoutes(db));
  app.use('/api/terminarten', getTerminartenRoutes(db));
  app.use('/api/umsaetze', getUmsaetzeRoutes(db, umsatzDienst));
  app.use('/api/einstellungen', getEinstellungenRoutes(db));
  app.use('/api/konfiguration', getKonfigRoutes(konfig));
  app.use('/api/zahler', getZahlerRoutes(db));
  app.use('/api/therapien', getTherapienRoutes(db));
  const datev = erstelleDatevDienst(db, { werte: konfig.wirksam });
  app.get('/api/datev/:jahr', async (req, res) => {
    const x = await datev.exportieren(Number(req.params.jahr));
    if (req.query.datei === undefined) { const { datei, ...vorschau } = x; return res.json(vorschau); }
    res.type('text/csv; charset=windows-1252').set('content-disposition', `attachment; filename="${x.dateiname}"`).send(x.datei);
  });
  app.use('/api/eingang', getEingangRoutes(eingangDienst));
  app.use('/api/rechnungen', getRechnungenRoutes(db, rechnungsDienst, mailDienst, konfig.wirksam, rechnungsVersand));

  app.use(express.static(path.join(__dirname, '..', 'public')));

  app.use((err, _req, res, _next) => {
    console.error(err);
    res.status(err.status || 500).json({ fehler: err.expose ? err.message : 'Interner Fehler' });
  });
  return app;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.env.DB_AUTO_MIGRATE === 'true') await knex.migrate.latest();
  const konfig = erstelleKonfigDienst(knex);
  const rechnungsDienst = erstelleRechnungsDienst(knex);
  const umsatzDienst = erstelleUmsatzDienst(knex, { werte: konfig.wirksam, nachAbruf: rechnungsDienst.abgleichen });
  if (process.env.FINTS_ZEITPLAN !== 'aus') umsatzDienst.starteZeitplan();
  const mailDienst = erstelleMailDienst(knex, { werte: konfig.wirksam });
  const rechnungsVersand = erstelleRechnungsVersand(knex, mailDienst, { werte: konfig.wirksam });
  if (process.env.RECHNUNG_ZEITPLAN !== 'aus') rechnungsDienst.starteZeitplan({ nachLauf: rechnungsVersand.nachLauf });
  const eingangDienst = erstelleEingangDienst(knex, { werte: konfig.wirksam });
  if (process.env.EINGANG_ZEITPLAN !== 'aus') eingangDienst.starteZeitplan();
  erstelleApp(knex, { konfig, umsatzDienst, rechnungsDienst, eingangDienst, mailDienst, rechnungsVersand }).listen(PORT, () => console.log(`Lerntherapie-Manager auf http://localhost:${PORT}`));
}
