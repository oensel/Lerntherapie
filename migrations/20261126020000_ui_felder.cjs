// Felder, die die Oberfläche braucht: Jahrgang, Aufnahmedatum, Material vor dem Ersttermin, Sitzungsdokumentation.
// Terminstatus: geplant | stattgefunden | abgesagt (≥ 24 h, kostenfrei) | ausgefallen (< 24 h, berechnet) | unentschuldigt (berechnet)
exports.up = async (knex) => {
  await knex.schema.alterTable('klienten', (t) => {
    t.integer('geburtsjahr');
    t.date('aufnahme_datum');
    t.boolean('material_noetig').notNullable().defaultTo(false);
    t.date('material_versandt_am');
    t.string('material_versand_art'); // E-Mail | Post | persönlich
  });
  await knex.schema.alterTable('termine', (t) => {
    t.text('dokumentation');
    t.index(['klient_id', 'beginn']);
  });
};

exports.down = async (knex) => {
  await knex.schema.alterTable('termine', (t) => {
    t.dropIndex(['klient_id', 'beginn']);
    t.dropColumn('dokumentation');
  });
  await knex.schema.alterTable('klienten', (t) => {
    for (const c of ['geburtsjahr', 'aufnahme_datum', 'material_noetig', 'material_versandt_am', 'material_versand_art']) t.dropColumn(c);
  });
};
