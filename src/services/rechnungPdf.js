import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

const eur = (c) => (c / 100).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
const datum = (d) => new Date(d).toLocaleDateString('de-DE');
const monatName = (m) => { const [j, mo] = m.split('-').map(Number); return new Date(j, mo - 1, 1).toLocaleDateString('de-DE', { month: 'long', year: 'numeric' }); };

// Praxisdaten aus der .env (PRAXIS_NAME, PRAXIS_ANSCHRIFT mit "|" als Zeilentrenner, PRAXIS_IBAN, PRAXIS_BIC, PRAXIS_BANK, PRAXIS_STEUERNR, PRAXIS_HINWEIS)
export function praxisAusEnv(env = process.env) {
  return {
    name: env.PRAXIS_NAME || 'Lernpraxis',
    anschrift: (env.PRAXIS_ANSCHRIFT || '').split('|').map((s) => s.trim()).filter(Boolean),
    iban: env.PRAXIS_IBAN || '', bic: env.PRAXIS_BIC || '', bank: env.PRAXIS_BANK || '',
    steuernr: env.PRAXIS_STEUERNR || '',
    hinweis: env.PRAXIS_HINWEIS || 'Umsatzsteuerfrei gem. § 4 Nr. 21 UStG.',
  };
}

// Standardschriften können nur WinAnsi; Zeichen außerhalb ersetzen statt abzubrechen
const sauber = (s) => String(s ?? '').replace(/[^\x20-\x7E\xA0-\xFF€–„“’]/g, '?');

export async function erstelleRechnungPdf(r, positionen, praxis = praxisAusEnv()) {
  const doc = await PDFDocument.create();
  doc.setTitle(`Rechnung ${r.nummer}`);
  let page = doc.addPage([595.28, 841.89]); // A4
  const f = await doc.embedFont(StandardFonts.Helvetica);
  const fb = await doc.embedFont(StandardFonts.HelveticaBold);
  const grau = rgb(0.36, 0.41, 0.45);
  const L = 60, R = 535;
  const text = (s, x, y, { font = f, size = 10, color, rechts } = {}) => {
    s = sauber(s);
    page.drawText(s, { x: rechts ? x - font.widthOfTextAtSize(s, size) : x, y, size, font, color });
  };

  // Kopf
  text(praxis.name, L, 780, { font: fb, size: 16 });
  text([praxis.name, ...praxis.anschrift].join(' · '), L, 700, { size: 7, color: grau });
  r.empfaenger.split('\n').forEach((z, i) => text(z, L, 684 - i * 13));
  praxis.anschrift.forEach((z, i) => text(z, R, 780 - (i + 1) * 12, { size: 9, color: grau, rechts: true }));

  let y = 580;
  text(`Rechnung ${r.nummer}`, L, y, { font: fb, size: 14 });
  text(`Datum: ${datum(r.rechnungsdatum)}`, R, y, { rechts: true });
  y -= 22;
  text(`Klient/in: ${r.klient_name}${r.therapie_bezeichnung ? ` · ${r.therapie_bezeichnung}` : ''}`, L, y);
  y -= 14;
  text(`Leistungszeitraum: ${monatName(r.leistungsmonat)}`, L, y);

  // Tabelle
  y -= 34;
  text('Datum', L, y, { font: fb }); text('Leistung', L + 90, y, { font: fb }); text('Betrag', R, y, { font: fb, rechts: true });
  page.drawLine({ start: { x: L, y: y - 5 }, end: { x: R, y: y - 5 }, thickness: 0.5, color: grau });
  y -= 20;
  for (const p of positionen) {
    if (y < 120) { page = doc.addPage([595.28, 841.89]); y = 780; } // Seitenumbruch bei vielen Terminen
    text(datum(p.datum), L, y); text(p.beschreibung, L + 90, y); text(eur(p.betrag_cent), R, y, { rechts: true });
    y -= 16;
  }
  page.drawLine({ start: { x: L, y: y + 8 }, end: { x: R, y: y + 8 }, thickness: 0.5, color: grau });
  y -= 6;
  text('Gesamtbetrag', L + 90, y, { font: fb }); text(eur(r.betrag_cent), R, y, { font: fb, rechts: true });

  y -= 40;
  for (const z of [
    praxis.hinweis,
    `Bitte überweisen Sie den Betrag bis zum ${datum(r.faellig_am)} unter Angabe der Rechnungsnummer ${r.nummer}.`,
  ]) { text(z, L, y, { size: 9 }); y -= 14; }

  // Fuß
  const fuss = [praxis.iban && `IBAN ${praxis.iban}`, praxis.bic && `BIC ${praxis.bic}`, praxis.bank, praxis.steuernr && `St.-Nr. ${praxis.steuernr}`].filter(Boolean).join(' · ');
  if (fuss) text(fuss, L, 50, { size: 8, color: grau });
  return doc.save();
}

// Mahnung bzw. Zahlungserinnerung; offener Betrag = Rechnungsbetrag + Mahngebühren bis zu dieser Stufe
export async function erstelleMahnungPdf(r, mahnung, gebuehrenBisher, titel, praxis = praxisAusEnv()) {
  const doc = await PDFDocument.create();
  doc.setTitle(`${titel} zu Rechnung ${r.nummer}`);
  const page = doc.addPage([595.28, 841.89]);
  const f = await doc.embedFont(StandardFonts.Helvetica);
  const fb = await doc.embedFont(StandardFonts.HelveticaBold);
  const grau = rgb(0.36, 0.41, 0.45);
  const L = 60, R = 535;
  const text = (s, x, y, { font = f, size = 10, color, rechts } = {}) => {
    s = sauber(s);
    page.drawText(s, { x: rechts ? x - font.widthOfTextAtSize(s, size) : x, y, size, font, color });
  };
  text(praxis.name, L, 780, { font: fb, size: 16 });
  text([praxis.name, ...praxis.anschrift].join(' · '), L, 700, { size: 7, color: grau });
  r.empfaenger.split('\n').forEach((z, i) => text(z, L, 684 - i * 13));
  praxis.anschrift.forEach((z, i) => text(z, R, 780 - (i + 1) * 12, { size: 9, color: grau, rechts: true }));

  let y = 580;
  text(titel, L, y, { font: fb, size: 14 });
  text(`Datum: ${datum(mahnung.datum)}`, R, y, { rechts: true });
  y -= 30;
  const einleitung = mahnung.stufe === 1
    ? ['sicher ist es Ihrer Aufmerksamkeit entgangen: Für die unten genannte Rechnung konnten wir', 'bisher keinen Zahlungseingang feststellen.']
    : mahnung.stufe === 2
      ? ['trotz unserer Zahlungserinnerung ist die unten genannte Rechnung weiterhin offen.']
      : ['die unten genannte Rechnung ist trotz Erinnerung und Mahnung noch immer nicht beglichen.', 'Dies ist unsere letzte Mahnung.'];
  for (const z of ['Sehr geehrte Damen und Herren,', '', ...einleitung]) { text(z, L, y); y -= 14; }

  y -= 16;
  const zeile = (l, b, fett) => { text(l, L, y, { font: fett ? fb : f }); text(eur(b), R, y, { font: fett ? fb : f, rechts: true }); y -= 16; };
  zeile(`Rechnung ${r.nummer} vom ${datum(r.rechnungsdatum)}, fällig am ${datum(r.faellig_am)}`, r.betrag_cent);
  if (gebuehrenBisher) zeile('Mahngebühren', gebuehrenBisher);
  page.drawLine({ start: { x: L, y: y + 10 }, end: { x: R, y: y + 10 }, thickness: 0.5, color: grau });
  y -= 4;
  zeile('Offener Betrag', r.betrag_cent + gebuehrenBisher, true);
  text(`Klient/in: ${r.klient_name} · Leistungszeitraum ${monatName(r.leistungsmonat)}`, L, y, { size: 9, color: grau });

  y -= 30;
  for (const z of [
    `Bitte überweisen Sie den offenen Betrag bis zum ${datum(mahnung.frist)} unter Angabe der Rechnungsnummer ${r.nummer}.`,
    'Sollten Sie die Zahlung inzwischen geleistet haben, betrachten Sie dieses Schreiben bitte als gegenstandslos.',
    '', 'Mit freundlichen Grüßen', praxis.name,
  ]) { text(z, L, y, { size: 9.5 }); y -= 14; }

  const fuss = [praxis.iban && `IBAN ${praxis.iban}`, praxis.bic && `BIC ${praxis.bic}`, praxis.bank, praxis.steuernr && `St.-Nr. ${praxis.steuernr}`].filter(Boolean).join(' · ');
  if (fuss) text(fuss, L, 50, { size: 8, color: grau });
  return doc.save();
}
