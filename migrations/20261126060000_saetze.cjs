// Abrechnungssätze: allgemeiner Standard (einstellungen) und je Klient überschreibbar (NULL = Standard).
// Je Termin wird ein Betrag berechnet: stattgefunden → Stundensatz, ausgefallen (< 24 h abgesagt) → Ausfallbetrag,
// unentschuldigt → Betrag für Nichterscheinen. Bisher galt überall der Stundensatz, daher starten alle drei damit.
exports.up = async (knex) => {
  await knex.schema.createTable('einstellungen', (t) => {
    t.integer('id').primary().defaultTo(1);
    t.integer('stundensatz_cent').notNullable();
    t.integer('ausfall_cent').notNullable();
    t.integer('unentschuldigt_cent').notNullable();
    t.timestamp('aktualisiert_am', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });
  // Standard = häufigster bisheriger Stundensatz (sonst 58 €)
  const haeufig = await knex('klienten').whereNotNull('stundensatz_cent').select('stundensatz_cent')
    .count({ n: '*' }).groupBy('stundensatz_cent').orderBy('n', 'desc').first();
  const satz = haeufig?.stundensatz_cent ?? 5800;
  await knex('einstellungen').insert({ id: 1, stundensatz_cent: satz, ausfall_cent: satz, unentschuldigt_cent: satz });

  await knex.schema.alterTable('klienten', (t) => {
    t.integer('ausfall_cent');
    t.integer('unentschuldigt_cent');
  });
  // Klienten mit dem Standardsatz folgen künftig der allgemeinen Einstellung
  await knex('klienten').where({ stundensatz_cent: satz }).update({ stundensatz_cent: null });
};

exports.down = async (knex) => {
  const e = await knex('einstellungen').where({ id: 1 }).first();
  if (e) await knex('klienten').whereNull('stundensatz_cent').update({ stundensatz_cent: e.stundensatz_cent });
  await knex.schema.alterTable('klienten', (t) => {
    t.dropColumn('ausfall_cent');
    t.dropColumn('unentschuldigt_cent');
  });
  await knex.schema.dropTableIfExists('einstellungen');
};
