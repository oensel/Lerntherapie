// Rechnungen je Klient und Monat. Positionen sind eingefroren (Datum, Text, Betrag), damit spätere
// Änderungen an Terminen oder Stundensätzen eine erstellte Rechnung nicht verändern.
// Status: offen | bezahlt | storniert (überfällig ergibt sich aus faellig_am)
exports.up = async (knex) => {
  await knex.schema.createTable('rechnungen', (t) => {
    t.increments('id');
    t.string('nummer').notNullable().unique(); // z.B. 2026-12-001 (Jahr/Monat der Erstellung + laufende Nr.)
    t.integer('klient_id').references('klienten.id').onDelete('SET NULL');
    t.string('leistungsmonat', 7).notNullable(); // YYYY-MM
    t.date('rechnungsdatum').notNullable();
    t.date('faellig_am').notNullable();
    t.integer('betrag_cent').notNullable();
    t.text('empfaenger').notNullable(); // Anschrift zum Zeitpunkt der Erstellung
    t.string('klient_name').notNullable();
    t.string('status').notNullable().defaultTo('offen');
    t.date('bezahlt_am');
    t.integer('umsatz_id').references('umsaetze.id').onDelete('SET NULL');
    t.timestamp('erstellt_am', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.unique(['klient_id', 'leistungsmonat']);
    t.index(['status']);
  });
  await knex.schema.createTable('rechnungspositionen', (t) => {
    t.increments('id');
    t.integer('rechnung_id').notNullable().references('rechnungen.id').onDelete('CASCADE');
    t.integer('termin_id').references('termine.id').onDelete('SET NULL');
    t.date('datum').notNullable();
    t.string('beschreibung').notNullable();
    t.integer('betrag_cent').notNullable();
  });
  await knex.schema.alterTable('termine', (t) => {
    t.integer('rechnung_id').references('rechnungen.id').onDelete('SET NULL');
  });
};

exports.down = async (knex) => {
  await knex.schema.alterTable('termine', (t) => t.dropColumn('rechnung_id'));
  await knex.schema.dropTableIfExists('rechnungspositionen');
  await knex.schema.dropTableIfExists('rechnungen');
};
