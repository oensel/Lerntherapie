// Beträge und Terminarten zusammengeführt: jede Terminart hat neben Preis und üblicher Dauer eigene Beträge für
// Ausfall (< 24 h abgesagt) und Nichterscheinen. Termine frieren auch diese beim Anlegen ein.
// Vorbelegung: die bisherigen allgemeinen Beträge aus `einstellungen`.
exports.up = async (knex) => {
  const e = await knex('einstellungen').where({ id: 1 }).first();
  await knex.schema.alterTable('terminarten', (t) => { t.integer('ausfall_cent'); t.integer('unentschuldigt_cent'); });
  await knex('terminarten').update({ ausfall_cent: e?.ausfall_cent ?? knex.ref('preis_cent'), unentschuldigt_cent: e?.unentschuldigt_cent ?? knex.ref('preis_cent') });
  await knex.raw('alter table terminarten alter column ausfall_cent set not null, alter column unentschuldigt_cent set not null');
  await knex.schema.alterTable('termine', (t) => { t.integer('ausfall_cent'); t.integer('unentschuldigt_cent'); });
  await knex.raw('update termine t set ausfall_cent = a.ausfall_cent, unentschuldigt_cent = a.unentschuldigt_cent from terminarten a where t.terminart_id = a.id and t.rechnung_id is null');
};
exports.down = async (knex) => {
  await knex.schema.alterTable('termine', (t) => { t.dropColumn('ausfall_cent'); t.dropColumn('unentschuldigt_cent'); });
  await knex.schema.alterTable('terminarten', (t) => { t.dropColumn('ausfall_cent'); t.dropColumn('unentschuldigt_cent'); });
};
