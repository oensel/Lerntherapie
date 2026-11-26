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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);

export function erstelleApp(db, { rechnungsDienst = erstelleRechnungsDienst(db), umsatzDienst = erstelleUmsatzDienst(db, { nachAbruf: rechnungsDienst.abgleichen }), mailDienst = erstelleMailDienst(db) } = {}) {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

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
  app.use('/api/umsaetze', getUmsaetzeRoutes(db, umsatzDienst));
  app.use('/api/rechnungen', getRechnungenRoutes(db, rechnungsDienst, mailDienst));

  app.use(express.static(path.join(__dirname, '..', 'public')));

  app.use((err, _req, res, _next) => {
    console.error(err);
    res.status(err.status || 500).json({ fehler: err.expose ? err.message : 'Interner Fehler' });
  });
  return app;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.env.DB_AUTO_MIGRATE === 'true') await knex.migrate.latest();
  const rechnungsDienst = erstelleRechnungsDienst(knex);
  const umsatzDienst = erstelleUmsatzDienst(knex, { nachAbruf: rechnungsDienst.abgleichen });
  if (process.env.FINTS_ZEITPLAN !== 'aus') umsatzDienst.starteZeitplan();
  if (process.env.RECHNUNG_ZEITPLAN !== 'aus') rechnungsDienst.starteZeitplan();
  erstelleApp(knex, { umsatzDienst, rechnungsDienst }).listen(PORT, () => console.log(`Lerntherapie-Manager auf http://localhost:${PORT}`));
}
