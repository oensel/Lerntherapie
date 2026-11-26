// 1) Einstellungen aus der Anwendung (Mail, FinTS, Praxis) – Geheimnisse verschlüsselt, siehe src/services/konfigDienst.js
// 2) Zahler je Klient (meist Eltern/Elternteil, auch Jugendamt) und Therapiearten je Klient, jede mit eigenem Zahler
//    und eigenen Beträgen (NULL = allgemeiner Standard). Termine und Rechnungen gehören zu einer Therapie.
//    Bestehende Daten: je Klient ein Zahler aus den bisherigen Kontaktfeldern und eine Therapie mit den bisherigen Sätzen.
exports.up = async (knex) => {
  await knex.schema.createTable('konfiguration', (t) => {
    t.string('schluessel').primary();
    t.text('wert').notNullable();
    t.timestamp('aktualisiert_am', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });

  await knex.schema.createTable('zahler', (t) => {
    t.increments('id');
    t.integer('klient_id').notNullable().references('klienten.id').onDelete('CASCADE');
    t.string('art').notNullable().defaultTo('eltern'); // eltern | jugendamt | sonstige
    t.string('name').notNullable();
    t.text('adresse');
    t.string('email');
    t.string('telefon');
    t.timestamp('erstellt_am', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });
  await knex.schema.createTable('therapien', (t) => {
    t.increments('id');
    t.integer('klient_id').notNullable().references('klienten.id').onDelete('CASCADE');
    t.string('bezeichnung').notNullable(); // z.B. LRS-Therapie, Dyskalkulie-Therapie
    t.integer('zahler_id').references('zahler.id').onDelete('SET NULL');
    t.integer('stundensatz_cent');
    t.integer('ausfall_cent');
    t.integer('unentschuldigt_cent');
    t.boolean('aktiv').notNullable().defaultTo(true);
    t.timestamp('erstellt_am', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });
  await knex.schema.alterTable('termine', (t) => t.integer('therapie_id').references('therapien.id').onDelete('SET NULL'));
  await knex.schema.alterTable('rechnungen', (t) => {
    t.integer('therapie_id').references('therapien.id').onDelete('SET NULL');
    t.integer('zahler_id').references('zahler.id').onDelete('SET NULL');
    t.string('therapie_bezeichnung');
    t.string('empfaenger_email');
  });

  for (const k of await knex('klienten')) {
    const [z] = await knex('zahler').insert({
      klient_id: k.id, art: k.kostentraeger === 'jugendamt' ? 'jugendamt' : 'eltern',
      name: k.sorgeberechtigte || `Erziehungsberechtigte von ${k.vorname} ${k.nachname}`, adresse: k.adresse, email: k.email, telefon: k.telefon,
    }).returning('*');
    const [th] = await knex('therapien').insert({
      klient_id: k.id, bezeichnung: k.schwerpunkt ? `Lerntherapie (${k.schwerpunkt})` : 'Lerntherapie', zahler_id: z.id,
      stundensatz_cent: k.stundensatz_cent, ausfall_cent: k.ausfall_cent, unentschuldigt_cent: k.unentschuldigt_cent,
    }).returning('*');
    await knex('termine').where({ klient_id: k.id }).update({ therapie_id: th.id });
    await knex('rechnungen').where({ klient_id: k.id }).update({ therapie_id: th.id, zahler_id: z.id, therapie_bezeichnung: th.bezeichnung, empfaenger_email: z.email });
  }

  await knex.schema.alterTable('rechnungen', (t) => {
    t.dropUnique(['klient_id', 'leistungsmonat']);
    t.unique(['therapie_id', 'leistungsmonat']);
  });
  await knex.schema.alterTable('klienten', (t) => {
    t.dropColumn('stundensatz_cent');
    t.dropColumn('ausfall_cent');
    t.dropColumn('unentschuldigt_cent');
  });
};

exports.down = async (knex) => {
  await knex.schema.alterTable('klienten', (t) => {
    t.integer('stundensatz_cent');
    t.integer('ausfall_cent');
    t.integer('unentschuldigt_cent');
  });
  for (const th of await knex('therapien').orderBy('id', 'desc')) {
    await knex('klienten').where({ id: th.klient_id })
      .update({ stundensatz_cent: th.stundensatz_cent, ausfall_cent: th.ausfall_cent, unentschuldigt_cent: th.unentschuldigt_cent });
  }
  await knex.schema.alterTable('rechnungen', (t) => {
    t.dropUnique(['therapie_id', 'leistungsmonat']);
    for (const c of ['therapie_id', 'zahler_id', 'therapie_bezeichnung', 'empfaenger_email']) t.dropColumn(c);
  });
  await knex.schema.alterTable('rechnungen', (t) => t.unique(['klient_id', 'leistungsmonat']));
  await knex.schema.alterTable('termine', (t) => t.dropColumn('therapie_id'));
  await knex.schema.dropTableIfExists('therapien');
  await knex.schema.dropTableIfExists('zahler');
  await knex.schema.dropTableIfExists('konfiguration');
};
