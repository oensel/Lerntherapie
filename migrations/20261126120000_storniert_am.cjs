// Zeitpunkt des Stornos für den Verlauf einer Rechnung
exports.up = (knex) => knex.schema.alterTable('rechnungen', (t) => t.timestamp('storniert_am', { useTz: true }));
exports.down = (knex) => knex.schema.alterTable('rechnungen', (t) => t.dropColumn('storniert_am'));
