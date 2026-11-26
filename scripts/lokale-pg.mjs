// Lokales PostgreSQL ohne Installation für die Entwicklung: node scripts/lokale-pg.mjs start|stopp
import 'dotenv/config';
import EmbeddedPostgres from 'embedded-postgres';
import fs from 'node:fs';

const verzeichnis = 'data/pg-lokal';
const pg = new EmbeddedPostgres({
  databaseDir: verzeichnis,
  user: process.env.DB_USER || 'lerntherapie',
  password: process.env.DB_PASSWORD || 'lerntherapie',
  port: Number(process.env.DB_PORT || 5432),
  persistent: true,
});

const befehl = process.argv[2];
if (befehl === 'start') {
  const neu = !fs.existsSync(verzeichnis);
  if (neu) await pg.initialise();
  await pg.start();
  if (neu) await pg.createDatabase(process.env.DB_NAME || 'lerntherapie');
  console.log('PostgreSQL läuft (Strg+C beendet).');
  process.on('SIGINT', async () => { await pg.stop(); process.exit(0); });
} else {
  console.log('Aufruf: node scripts/lokale-pg.mjs start');
}
