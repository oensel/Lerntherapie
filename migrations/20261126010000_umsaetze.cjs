exports.up = async (knex) => {
  // Kontoumsätze aus dem FinTS-Abruf. Betrag in Cent (Eingang positiv, Abgang negativ).
  await knex.schema.createTable('umsaetze', (t) => {
    t.increments('id');
    t.string('konto').notNullable(); // IBAN bzw. Kontonummer
    t.date('buchungsdatum').notNullable();
    t.date('valuta');
    t.integer('betrag_cent').notNullable();
    t.string('waehrung', 3).notNullable().defaultTo('EUR');
    t.string('gegen_name');
    t.string('gegen_iban');
    t.string('gegen_bic');
    t.text('verwendungszweck');
    t.string('buchungstext');
    t.string('end_to_end_referenz');
    t.string('mandatsreferenz');
    // Fingerabdruck über die Buchungsdaten, damit überlappende Abrufe keine Doppelten erzeugen
    t.string('fingerabdruck', 64).notNullable().unique();
    t.boolean('gesehen').notNullable().defaultTo(false);
    t.timestamp('abgerufen_am', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index(['buchungsdatum']);
    t.index(['gesehen']);
  });

  // Zustand des FinTS-Zugangs (Bankparameter ohne PIN, TAN-Verfahren, letzter Abruf und Fehler)
  await knex.schema.createTable('fints_zustand', (t) => {
    t.integer('id').primary().defaultTo(1);
    t.jsonb('banking_information');
    t.integer('tan_methode');
    t.string('tan_medium');
    t.string('konto');
    t.timestamp('letzter_abruf', { useTz: true });
    t.timestamp('letzter_erfolg', { useTz: true });
    t.text('letzter_fehler');
    t.boolean('freigabe_noetig').notNullable().defaultTo(false);
  });
  await knex('fints_zustand').insert({ id: 1 });

  await knex.schema.createTable('fints_abrufe', (t) => {
    t.increments('id');
    t.timestamp('gestartet_am', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.string('ausloeser').notNullable(); // zeitplan | manuell
    t.string('ergebnis').notNullable(); // ok | fehler | freigabe_noetig
    t.integer('neue_umsaetze').notNullable().defaultTo(0);
    t.text('meldung');
  });
};

exports.down = async (knex) => {
  await knex.schema.dropTableIfExists('fints_abrufe');
  await knex.schema.dropTableIfExists('fints_zustand');
  await knex.schema.dropTableIfExists('umsaetze');
};
