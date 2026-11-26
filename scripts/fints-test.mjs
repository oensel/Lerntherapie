// FinTS-Verbindungstest: synchronisiert mit der Bank, wählt das TAN-Verfahren und listet die Umsätze der letzten Tage.
//   node scripts/fints-test.mjs [tage=30]
// Konfiguration in .env: FINTS_PRODUKT_ID, FINTS_URL, FINTS_BLZ, FINTS_BENUTZER (optional FINTS_KUNDEN_ID, FINTS_DEBUG=true).
// Die PIN wird nur interaktiv abgefragt und nirgends gespeichert. Die Bankparameter (ohne PIN) landen in data/fints-bankinfo.json,
// damit spätere Läufe nicht neu synchronisieren müssen (systemId bleibt gleich).
import 'dotenv/config';
import fs from 'node:fs';
import readline from 'node:readline/promises';
import { FinTSClient, FinTSConfig } from 'lib-fints';

const INFO_DATEI = 'data/fints-bankinfo.json';
const PRODUKT_VERSION = '0.1';
const tage = Number(process.argv[2] || 30);

const fehlend = ['FINTS_PRODUKT_ID', 'FINTS_URL', 'FINTS_BLZ', 'FINTS_BENUTZER'].filter((k) => !process.env[k]);
if (fehlend.length) {
  console.error(`Bitte in .env setzen: ${fehlend.join(', ')}`);
  process.exit(1);
}
const { FINTS_PRODUKT_ID: produktId, FINTS_URL: url, FINTS_BLZ: blz, FINTS_BENUTZER: benutzer } = process.env;

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

async function frageVerdeckt(text) {
  // Eingabe nicht auf dem Bildschirm anzeigen
  const ausgabe = rl._writeToOutput;
  rl._writeToOutput = (s) => { if (s.includes(text)) ausgabe.call(rl, s); };
  const antwort = await rl.question(text);
  rl._writeToOutput = ausgabe;
  process.stdout.write('\n');
  return antwort;
}

function zeigeBankantworten(antwort) {
  for (const a of antwort.bankAnswers ?? []) console.log(`  Bank ${a.code}: ${a.text}`);
}

// Führt einen Auftrag aus und bedient eine TAN-Abfrage (TAN-Eingabe oder Freigabe in der App).
async function mitTan(start, fortsetzen) {
  let antwort = await start();
  while (antwort.success && antwort.requiresTan) {
    console.log(`\nTAN erforderlich: ${antwort.tanChallenge ?? ''}`);
    const tan = await rl.question('TAN eingeben (bei Freigabe in der Banking-App nur Enter nach der Freigabe): ');
    antwort = await fortsetzen(antwort.tanReference, tan.trim() || undefined);
  }
  zeigeBankantworten(antwort);
  if (!antwort.success) throw new Error('Auftrag von der Bank abgelehnt');
  return antwort;
}

const pin = await frageVerdeckt('PIN: ');
const gespeichert = fs.existsSync(INFO_DATEI) ? JSON.parse(fs.readFileSync(INFO_DATEI, 'utf8')) : null;

const config = gespeichert
  ? FinTSConfig.fromBankingInformation(produktId, PRODUKT_VERSION, gespeichert.bankingInformation, benutzer, pin, gespeichert.tanMethodId)
  : FinTSConfig.forFirstTimeUse(produktId, PRODUKT_VERSION, url, blz, benutzer, pin, process.env.FINTS_KUNDEN_ID);
config.debugEnabled = process.env.FINTS_DEBUG === 'true';
const client = new FinTSClient(config);

try {
  let tanMethodId = gespeichert?.tanMethodId;
  if (!gespeichert) {
    console.log('Erste Synchronisierung …');
    let sync = await mitTan(() => client.synchronize(), (ref, tan) => client.synchronizeWithTan(ref, tan));
    const verfahren = config.availableTanMethods ?? [];
    console.log('\nVerfügbare TAN-Verfahren:');
    verfahren.forEach((v, i) => console.log(`  [${i + 1}] ${v.id} – ${v.name}`));
    const wahl = verfahren.length > 1 ? Number(await rl.question('Nummer wählen: ')) - 1 : 0;
    tanMethodId = verfahren[wahl]?.id ?? sync.bankingInformation?.bpd?.availableTanMethodIds?.[0];
    client.selectTanMethod(tanMethodId);
    const tm = config.selectedTanMethod;
    if (tm?.activeTanMedia?.length) client.selectTanMedia(tm.activeTanMedia[0]);
    console.log('Zweite Synchronisierung mit TAN-Verfahren …');
    sync = await mitTan(() => client.synchronize(), (ref, tan) => client.synchronizeWithTan(ref, tan));
  }

  const konten = config.bankingInformation?.upd?.bankAccounts ?? [];
  if (!konten.length) throw new Error('Die Bank hat keine Konten geliefert');
  console.log('\nKonten:');
  konten.forEach((k, i) => console.log(`  [${i + 1}] ${k.iban ?? k.accountNumber} ${k.accountType ?? ''} ${k.product ?? ''}`));
  const konto = konten.length > 1 ? konten[Number(await rl.question('Konto wählen: ')) - 1] : konten[0];

  const von = new Date(Date.now() - tage * 86400000);
  console.log(`\nUmsätze seit ${von.toLocaleDateString('de-DE')} …`);
  const ums = await mitTan(() => client.getAccountStatements(konto, von),
    (ref, tan) => client.getAccountStatementsWithTan(ref, tan));

  const buchungen = (ums.statements ?? []).flatMap((s) => s.transactions);
  for (const b of buchungen) {
    const betrag = b.amount.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
    console.log(`${new Date(b.entryDate).toLocaleDateString('de-DE')}  ${betrag.padStart(12)}  ${(b.remoteName ?? '').padEnd(28).slice(0, 28)}  ${b.purpose ?? ''}`);
  }
  console.log(`\n${buchungen.length} Buchungen abgerufen.`);

  fs.mkdirSync('data', { recursive: true });
  fs.writeFileSync(INFO_DATEI, JSON.stringify({ tanMethodId, bankingInformation: config.bankingInformation }, null, 2));
  console.log(`Bankparameter gespeichert in ${INFO_DATEI} (ohne PIN).`);
} catch (e) {
  console.error(`\nFehler: ${e.message}`);
  process.exitCode = 1;
} finally {
  rl.close();
}
