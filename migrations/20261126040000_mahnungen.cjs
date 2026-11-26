// Mahnwesen: Stufe 1 Zahlungserinnerung, 2 Mahnung, 3 letzte Mahnung. Gebühren in Cent, neue Zahlungsfrist je Mahnung.
exports.up = async (knex) => {
  await knex.schema.createTable('mahnungen', (t) => {
    t.increments('id');
    t.integer('rechnung_id').notNullable().references('rechnungen.id').onDelete('CASCADE');
    t.integer('stufe').notNullable();
    t.date('datum').notNullable();
    t.date('frist').notNullable();
    t.integer('gebuehr_cent').notNullable().defaultTo(0);
    t.timestamp('erstellt_am', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.unique(['rechnung_id', 'stufe']);
  });
  await knex.schema.alterTable('rechnungen', (t) => t.integer('mahnstufe').notNullable().defaultTo(0));
};

exports.down = async (knex) => {
  await knex.schema.alterTable('rechnungen', (t) => t.dropColumn('mahnstufe'));
  await knex.schema.dropTableIfExists('mahnungen');
};
