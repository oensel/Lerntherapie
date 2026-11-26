require('dotenv').config({ quiet: true });
const { baueVerbindung } = require('./src/config/dbVerbindung.cjs');

module.exports = {
  client: 'pg',
  connection: baueVerbindung(process.env),
  pool: { min: 1, max: 10 },
  migrations: { directory: './migrations' },
};
