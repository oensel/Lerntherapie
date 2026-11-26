// Rechnungseingang (Vorbild Dojo Pro): Rechnungen aus einem eigenen IMAP-Postfach (je PDF-Anhang ein Datensatz) oder per Upload.
// Status: neu (im Postfach-Eingang, noch nicht gesichtet) | eingang (als Eingangsrechnung markiert) | bezahlt | verworfen.
// Nach dem Markieren liest Gemini Kopfdaten und Positionen aus und ordnet jede Position einer EÜR-Kategorie zu.
exports.up = async (knex) => {
  await knex.schema.createTable('eingangsrechnungen', (t) => {
    t.increments('id');
    t.string('status').notNullable().defaultTo('neu');
    t.string('verarbeitung').notNullable().defaultTo('offen'); // offen | wartet | laeuft | fertig | fehler
    t.text('verarbeitung_hinweis');
    t.string('quelle').notNullable().defaultTo('mail'); // mail | upload
    t.string('mail_message_id', 250);
    t.integer('mail_teil').notNullable().defaultTo(0);
    t.string('mail_absender'); t.string('mail_betreff');
    t.timestamp('empfangen_am', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.string('dateiname'); t.string('mime');
    t.binary('datei');
    t.string('lieferant'); t.string('rechnungsnummer');
    t.date('rechnungsdatum'); t.date('faellig_am'); t.date('bezahlt_am');
    t.integer('brutto_cent'); t.integer('ust_cent');
    t.string('beschreibung');
    t.string('ki_modell');
    t.timestamp('erstellt_am', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index(['status']);
  });
  await knex.raw(`alter table eingangsrechnungen add constraint eingangsrechnungen_status_chk check (status in ('neu','eingang','bezahlt','verworfen'))`);
  await knex.raw('create unique index eingangsrechnungen_mail_uq on eingangsrechnungen (mail_message_id, mail_teil) where mail_message_id is not null');

  await knex.schema.createTable('eingangsrechnung_posten', (t) => {
    t.increments('id');
    t.integer('rechnung_id').notNullable().references('eingangsrechnungen.id').onDelete('CASCADE').index();
    t.integer('pos').notNullable().defaultTo(0);
    t.string('beschreibung').notNullable();
    t.integer('betrag_cent').notNullable(); // brutto
    t.string('kategorie').notNullable();
    t.boolean('von_hand').notNullable().defaultTo(false);
  });
};

exports.down = async (knex) => {
  await knex.schema.dropTableIfExists('eingangsrechnung_posten');
  await knex.schema.dropTableIfExists('eingangsrechnungen');
};
