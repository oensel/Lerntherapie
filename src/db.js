import knexFactory from 'knex';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const konfig = require('../knexfile.cjs');

// Die eine zentrale Knex-Instanz; Routen bekommen sie per Factory übergeben.
export const knex = knexFactory(konfig);
