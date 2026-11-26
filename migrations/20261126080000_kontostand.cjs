// Letzter bekannter Kontostand aus dem FinTS-Abruf (Schlusssaldo); daraus wird der Kontoverlauf rückwärts berechnet
exports.up = (knex) => knex.schema.alterTable('fints_zustand', (t) => {
  t.bigInteger('saldo_cent');
  t.date('saldo_datum');
});
exports.down = (knex) => knex.schema.alterTable('fints_zustand', (t) => {
  t.dropColumn('saldo_cent');
  t.dropColumn('saldo_datum');
});
