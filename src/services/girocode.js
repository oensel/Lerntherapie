// Überweisungs-QR-Code nach EPC069-12 („GiroCode“) für Rechnungen und Mahnungen (Vorbild: Dojo Pro, beitragsrechnung.js).
// Die Banking-App übernimmt Empfänger, IBAN, Betrag und Verwendungszweck (= Rechnungsnummer, damit der Zahlungsabgleich greift).
import QRCode from 'qrcode';
import { rgb } from 'pdf-lib';

const einzeilig = (t, max) => String(t ?? '').replace(/[\r\n]+/g, ' ').trim().slice(0, max);
export const ibanNormal = (iban) => String(iban ?? '').replace(/\s+/g, '').toUpperCase();

/** Prüfziffer nach ISO 13616 (Modulo 97). */
export function ibanGueltig(iban) {
  const i = ibanNormal(iban);
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(i)) return false;
  const ziffern = (i.slice(4) + i.slice(0, 4)).replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  let rest = 0;
  for (const z of ziffern) rest = (rest * 10 + Number(z)) % 97;
  return rest === 1;
}

/** Inhalt des EPC-QR-Codes (Version 002, UTF-8, SEPA-Überweisung); null, wenn IBAN oder Betrag nicht passen. */
export function epcPayload({ name, iban, bic = '', betragCent, zweck }) {
  if (!ibanGueltig(iban) || !(betragCent > 0) || betragCent > 99999999999) return null;
  return [
    'BCD', '002', '1', 'SCT',
    einzeilig(bic, 11).replace(/\s/g, ''),
    einzeilig(name, 70),
    ibanNormal(iban),
    `EUR${(betragCent / 100).toFixed(2)}`,
    '', '', // Purpose-Code, strukturierte Referenz
    einzeilig(zweck, 140),
  ].join('\n');
}

/** Zeichnet den QR-Code als Vektorgrafik mit Ruhezone; x/y = linke untere Ecke, groesse in pt. */
export function zeichneQr(seite, text, { x, y, groesse }) {
  const qr = QRCode.create(text, { errorCorrectionLevel: 'M' });
  const n = qr.modules.size;
  const ruhe = 4;
  const modul = groesse / (n + 2 * ruhe);
  seite.drawRectangle({ x, y, width: groesse, height: groesse, color: rgb(1, 1, 1) });
  for (let zeile = 0; zeile < n; zeile++) {
    for (let spalte = 0; spalte < n; spalte++) {
      if (!qr.modules.get(zeile, spalte)) continue;
      seite.drawRectangle({ x: x + (spalte + ruhe) * modul, y: y + groesse - (zeile + ruhe + 1) * modul, width: modul + 0.2, height: modul + 0.2, color: rgb(0, 0, 0) });
    }
  }
}
