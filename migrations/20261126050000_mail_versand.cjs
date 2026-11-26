// Protokoll des E-Mail-Versands von Rechnungen und Mahnungen (auch fehlgeschlagene Versuche)
exports.up = async (knex) => {
  await knex.schema.createTable('mail_versand', (t) => {
    t.increments('id');
    t.integer('rechnung_id').references('rechnungen.id').onDelete('CASCADE');
    t.integer('mahnung_id').references('mahnungen.id').onDelete('CASCADE');
    t.string('an').notNullable();
    t.string('betreff').notNullable();
    t.string('message_id');
    t.text('fehler');
    t.timestamp('gesendet_am', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index(['rechnung_id']);
  });
  await knex.schema.alterTable('rechnungen', (t) => t.timestamp('versendet_am', { useTz: true }));
  await knex.schema.alterTable('mahnungen', (t) => t.timestamp('versendet_am', { useTz: true }));
};

exports.down = async (knex) => {
  await knex.schema.alterTable('mahnungen', (t) => t.dropColumn('versendet_am'));
  await knex.schema.alterTable('rechnungen', (t) => t.dropColumn('versendet_am'));
  await knex.schema.dropTableIfExists('mail_versand');
};
