// Automatischer Versand der Rechnungen nach dem Monatslauf (am 3.); aus = Rechnungen bleiben im Rechnungsausgang zur Prüfung.
exports.up = (knex) => knex.schema.alterTable('einstellungen', (t) => t.boolean('autoversand').notNullable().defaultTo(false));
exports.down = (knex) => knex.schema.alterTable('einstellungen', (t) => t.dropColumn('autoversand'));
