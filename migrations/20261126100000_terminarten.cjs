// Terminarten mit Dauer und Preis (in den Einstellungen verwaltet). Ein Termin merkt sich beim Anlegen Art, geplante Dauer und
// Preis (eingefroren, spätere Preisänderungen ändern bestehende Termine nicht). Beim Abschluss wird die reale Dauer über `ende`
// gesetzt; berechnet wird anteilig: Preis × reale Dauer / geplante Dauer. Termine ohne Art rechnen weiter mit den Sätzen der Therapie.
exports.up = async (knex) => {
  await knex.schema.createTable('terminarten', (t) => {
    t.increments('id');
    t.string('name').notNullable();
    t.integer('dauer_min').notNullable();
    t.integer('preis_cent').notNullable();
    t.boolean('aktiv').notNullable().defaultTo(true); // false = entfernt, aber noch von Terminen genutzt
    t.integer('sortierung').notNullable().defaultTo(0);
    t.timestamp('erstellt_am', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });
  await knex.schema.alterTable('termine', (t) => {
    t.integer('terminart_id').references('terminarten.id').onDelete('SET NULL');
    t.string('terminart_name');
    t.integer('geplante_dauer_min');
    t.integer('preis_cent');
  });
  const e = await knex('einstellungen').where({ id: 1 }).first();
  await knex('terminarten').insert({ name: 'Therapiestunde', dauer_min: 60, preis_cent: e?.stundensatz_cent ?? 5800, sortierung: 1 });
};

exports.down = async (knex) => {
  await knex.schema.alterTable('termine', (t) => { for (const c of ['terminart_id', 'terminart_name', 'geplante_dauer_min', 'preis_cent']) t.dropColumn(c); });
  await knex.schema.dropTableIfExists('terminarten');
};
