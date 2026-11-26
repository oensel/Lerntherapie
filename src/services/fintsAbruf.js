import fs from 'node:fs';
import { FinTSClient, FinTSConfig } from 'lib-fints';
import { bildeUmsaetze } from './umsatzAbbildung.js';
import { setzeTanMedium } from './fintsTanMedium.js';

const PRODUKT_VERSION = '0.1';
const ERSTER_ABRUF_TAGE = 90;
const UEBERLAPPUNG_TAGE = 10;
const FREIGABE_WARTEZEIT_MS = 5 * 60_000; // so lange wird auf die Freigabe in der S-pushTAN-App gewartet
const FREIGABE_INTERVALL_MS = 5_000;

const pause = (ms) => new Promise((r) => setTimeout(r, ms));

// Holt die gespeicherten Bankparameter; beim ersten Mal aus der Datei des Verbindungstests (npm run fints:test).
async function ladeZustand(knex, env) {
  let z = await knex('fints_zustand').where({ id: 1 }).first();
  if (!z.banking_information) {
    const datei = env.FINTS_BANKINFO_DATEI || 'data/fints-bankinfo.json';
    if (!fs.existsSync(datei)) throw new Error('Noch keine Bankverbindung eingerichtet: einmal "npm run fints:test" ausführen');
    const info = JSON.parse(fs.readFileSync(datei, 'utf8'));
    await knex('fints_zustand').where({ id: 1 }).update({
      banking_information: JSON.stringify(info.bankingInformation),
      tan_methode: info.tanMethodId,
      tan_medium: info.tanMedium ?? env.FINTS_TAN_MEDIUM ?? null,
    });
    z = await knex('fints_zustand').where({ id: 1 }).first();
  }
  return z;
}

// Führt einen Auftrag aus. Verlangt die Bank eine Freigabe (pushTAN), wird bis zu 5 Minuten auf die Freigabe in der App gewartet.
async function mitFreigabe(start, fortsetzen, beiFreigabe) {
  let antwort = await start();
  if (antwort.success && antwort.requiresTan) {
    await beiFreigabe?.(antwort.tanChallenge);
    const ende = Date.now() + FREIGABE_WARTEZEIT_MS;
    while (antwort.success && antwort.requiresTan && Date.now() < ende) {
      await pause(FREIGABE_INTERVALL_MS);
      antwort = await fortsetzen(antwort.tanReference);
    }
    if (antwort.requiresTan) {
      const e = new Error('Freigabe in der S-pushTAN-App ist nicht erfolgt');
      e.freigabe = true;
      throw e;
    }
  }
  if (!antwort.success) {
    const text = (antwort.bankAnswers ?? []).map((a) => `${a.code} ${a.text}`).join(' / ');
    throw new Error(`Bank lehnt ab: ${text}`);
  }
  return antwort;
}

/**
 * Ruft die Umsätze seit dem letzten erfolgreichen Abruf (mit Überlappung) ab und speichert neue Buchungen.
 * @returns {{ neu: number, abgerufen: number }}
 */
export async function holeUmsaetze(knex, { env = process.env, ausloeser = 'manuell', log = console } = {}) {
  const protokoll = async (ergebnis, neu, meldung) =>
    knex('fints_abrufe').insert({ ausloeser, ergebnis, neue_umsaetze: neu, meldung });
  await knex('fints_zustand').where({ id: 1 }).update({ letzter_abruf: knex.fn.now() });

  try {
    const fehlend = ['FINTS_PRODUKT_ID', 'FINTS_BENUTZER', 'FINTS_PIN'].filter((k) => !env[k]);
    if (fehlend.length) throw new Error(`Konfiguration fehlt: ${fehlend.join(', ')}`);
    const z = await ladeZustand(knex, env);

    const config = FinTSConfig.fromBankingInformation(env.FINTS_PRODUKT_ID, PRODUKT_VERSION, z.banking_information,
      env.FINTS_BENUTZER, env.FINTS_PIN, z.tan_methode);
    setzeTanMedium(config, z.tan_medium);
    const client = new FinTSClient(config);

    const konten = config.bankingInformation?.upd?.bankAccounts ?? [];
    const gewuenscht = env.FINTS_KONTO || z.konto;
    const konto = konten.find((k) => k.iban === gewuenscht || k.accountNumber === gewuenscht) ?? konten[0];
    if (!konto) throw new Error('Keine Konten in den Bankparametern');
    const kontoKennung = konto.iban ?? konto.accountNumber;

    const von = z.letzter_erfolg
      ? new Date(new Date(z.letzter_erfolg).getTime() - UEBERLAPPUNG_TAGE * 86400000)
      : new Date(Date.now() - ERSTER_ABRUF_TAGE * 86400000);

    const antwort = await mitFreigabe(
      () => client.getAccountStatements(konto, von),
      (ref) => client.getAccountStatementsWithTan(ref),
      async () => {
        log.info?.('FinTS: Freigabe in der S-pushTAN-App erforderlich, warte …');
        await knex('fints_zustand').where({ id: 1 }).update({ freigabe_noetig: true });
      },
    );

    const buchungen = (antwort.statements ?? []).flatMap((s) => s.transactions ?? []);
    const zeilen = bildeUmsaetze(kontoKennung, buchungen);
    const neu = zeilen.length
      ? (await knex('umsaetze').insert(zeilen).onConflict('fingerabdruck').ignore().returning('id')).length
      : 0;

    await knex('fints_zustand').where({ id: 1 }).update({
      banking_information: JSON.stringify(config.bankingInformation),
      konto: kontoKennung,
      letzter_erfolg: knex.fn.now(),
      letzter_fehler: null,
      freigabe_noetig: false,
    });
    await protokoll('ok', neu, `${zeilen.length} Buchungen seit ${von.toLocaleDateString('de-DE')}`);
    log.info?.(`FinTS: ${neu} neue von ${zeilen.length} Buchungen`);
    return { neu, abgerufen: zeilen.length };
  } catch (e) {
    await knex('fints_zustand').where({ id: 1 }).update({ letzter_fehler: e.message, freigabe_noetig: !!e.freigabe });
    await protokoll(e.freigabe ? 'freigabe_noetig' : 'fehler', 0, e.message);
    log.error?.(`FinTS-Abruf fehlgeschlagen: ${e.message}`);
    throw e;
  }
}
