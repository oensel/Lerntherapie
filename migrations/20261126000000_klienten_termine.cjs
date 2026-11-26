exports.up = async (knex) => {
  await knex.schema.createTable('klienten', (t) => {
    t.increments('id');
    t.string('vorname').notNullable();
    t.string('nachname').notNullable();
    t.date('geburtsdatum');
    t.string('schule');
    t.string('klasse');
    t.string('schwerpunkt'); // z.B. LRS, Dyskalkulie
    t.string('kostentraeger').notNullable().defaultTo('eltern'); // eltern | jugendamt
    t.integer('stundensatz_cent');
    t.text('sorgeberechtigte');
    t.string('email');
    t.string('telefon');
    t.text('adresse');
    t.text('notizen');
    t.boolean('aktiv').notNullable().defaultTo(true);
    t.timestamp('erstellt_am', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('aktualisiert_am', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });

  await knex.schema.createTable('termine', (t) => {
    t.increments('id');
    t.integer('klient_id').references('klienten.id').onDelete('SET NULL');
    t.timestamp('beginn', { useTz: true }).notNullable();
    t.timestamp('ende', { useTz: true }).notNullable();
    t.string('art').notNullable().defaultTo('sitzung'); // sitzung | erstgespraech | elterngespraech | sonstiges
    t.string('status').notNullable().defaultTo('geplant'); // geplant | stattgefunden | abgesagt | ausgefallen
    t.string('ort');
    t.text('notiz');
    t.timestamp('erstellt_am', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('aktualisiert_am', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index(['beginn']);
  });
};

exports.down = async (knex) => {
  await knex.schema.dropTableIfExists('termine');
  await knex.schema.dropTableIfExists('klienten');
};
