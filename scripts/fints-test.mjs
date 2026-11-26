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

// Liest eine Eingabe Zeichen für Zeichen im Raw-Modus, ohne sie anzuzeigen (zeigt * je Zeichen).
// Ohne echtes Terminal (z.B. umgeleitete Eingabe) wird abgebrochen, statt die PIN sichtbar zu lesen.
async function frageVerdeckt(text) {
  if (!process.stdin.isTTY) throw new Error('PIN-Eingabe braucht ein interaktives Terminal');
  rl.pause();
  process.stdout.write(text);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  return new Promise((resolve, reject) => {
    let wert = '';
    const beenden = (fehler) => {
      process.stdin.setRawMode(false);
      process.stdin.removeListener('data', beiDaten);
      process.stdout.write('\n');
      rl.resume();
      fehler ? reject(fehler) : resolve(wert);
    };
    const beiDaten = (puffer) => {
      for (const z of puffer.toString('utf8')) {
        if (z === '\r' || z === '\n') return beenden();
        if (z === '\u0003') return beenden(new Error('Abgebrochen'));
        if (z === '\u0008' || z === '\u007f') {
          if (wert) { wert = wert.slice(0, -1); process.stdout.write('\b \b'); }
        } else if (z >= ' ') {
          wert += z;
          process.stdout.write('*');
        }
      }
    };
    process.stdin.on('data', beiDaten);
  });
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
  ? FinTSConfig.fromBankingInformation(produktId, PRODUKT_VERSION, gespeichert.bankingInformation, benutzer, pin, gespeichert.tanMethodId, gespeichert.tanMedium)
  : FinTSConfig.forFirstTimeUse(produktId, PRODUKT_VERSION, url, blz, benutzer, pin, process.env.FINTS_KUNDEN_ID);
config.debugEnabled = process.env.FINTS_DEBUG === 'true';
const client = new FinTSClient(config);

try {
  let tanMethodId = gespeichert?.tanMethodId;
  let tanMedium = gespeichert?.tanMedium;
  if (!gespeichert) {
    console.log('Erste Synchronisierung …');
    let sync = await mitTan(() => client.synchronize(), (ref, tan) => client.synchronizeWithTan(ref, tan));
    const verfahren = config.availableTanMethods ?? [];
    console.log('\nVerfügbare TAN-Verfahren:');
    verfahren.forEach((v, i) => console.log(`  [${i + 1}] ${v.id} – ${v.name}`));
    const wahl = verfahren.length > 1 ? Number(await rl.question('Nummer wählen: ')) - 1 : 0;
    tanMethodId = verfahren[wahl]?.id ?? sync.bankingInformation?.bpd?.availableTanMethodIds?.[0];
    client.selectTanMethod(tanMethodId);
    // Verlangt die Bank eine Gerätebezeichnung (z.B. Sparkasse bei pushTAN), muss der Name des registrierten Geräts mit,
    // sonst sendet lib-fints "default" und die Bank antwortet mit 9955 "Gerätebezeichnung ist unbekannt".
    // Deshalb zuerst die TAN-Medien von der Bank holen (HKTAB): lib-fints hängt HKTAB an die Synchronisierung an, sobald ein
    // Medium erlaubt ist. Für diese eine Synchronisierung gilt das Medium als "optional", damit kein Name mitgeschickt wird;
    // den gelieferten Namen übernehmen wir danach 1:1.
    const tm = config.selectedTanMethod;
    const ERFORDERLICH = 2, OPTIONAL = 1;
    let synchronisiert = false;
    if (tm?.tanMediaRequirement === ERFORDERLICH && !process.env.FINTS_TAN_MEDIUM) {
      console.log('TAN-Medien bei der Bank abfragen …');
      tm.tanMediaRequirement = OPTIONAL;
      try {
        await mitTan(() => client.synchronize(), (ref, tan) => client.synchronizeWithTan(ref, tan));
        synchronisiert = true;
      } catch (e) {
        console.log(`  Abfrage ohne Gerätenamen nicht möglich (${e.message}).`);
      } finally {
        tm.tanMediaRequirement = ERFORDERLICH;
      }
      const medien = tm.activeTanMedia ?? [];
      if (medien.length) {
        console.log('Von der Bank gemeldete TAN-Medien:');
        medien.forEach((m, i) => console.log(`  [${i + 1}] ${m}`));
        const nr = medien.length > 1 ? Number(await rl.question('Nummer wählen: ')) - 1 : 0;
        client.selectTanMedia(medien[nr] ?? medien[0]);
        console.log(`Gewählt: ${config.tanMediaName}`);
      }
    }
    if (tm?.tanMediaRequirement === ERFORDERLICH && !config.tanMediaName) {
      const medium = process.env.FINTS_TAN_MEDIUM || (await rl.question(
        'Gerätebezeichnung des pushTAN-Geräts (steht im Online-Banking unter pushTAN-Verwaltung bzw. in der S-pushTAN-App): ')).trim();
      if (medium) client.selectTanMedia(medium);
      synchronisiert = false;
    }
    tanMedium = config.tanMediaName;
    // Konten (UPD) fehlen noch, wenn die Synchronisierung oben nicht durchging oder ohne Medium nicht möglich war
    if (!synchronisiert || !config.bankingInformation?.upd?.bankAccounts?.length) {
      console.log('Synchronisierung mit TAN-Verfahren …');
      sync = await mitTan(() => client.synchronize(), (ref, tan) => client.synchronizeWithTan(ref, tan));
    }
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
  fs.writeFileSync(INFO_DATEI, JSON.stringify({ tanMethodId, tanMedium, bankingInformation: config.bankingInformation }, null, 2));
  console.log(`Bankparameter gespeichert in ${INFO_DATEI} (ohne PIN).`);
} catch (e) {
  const ursache = e.cause ? ` (${e.cause.code ?? ''} ${e.cause.message ?? ''})` : '';
  console.error(`\nFehler: ${e.message}${ursache}`);
  if (e.cause?.code === 'ENOTFOUND') console.error(`Die Adresse in FINTS_URL ist nicht erreichbar: ${url}`);
  process.exitCode = 1;
} finally {
  rl.close();
}
