// Auswertung der Kontoumsätze: Ein- und Ausgaben je Monat und Kontoverlauf (Tagessaldo).
const tag = (d) => (typeof d === 'string' ? d.slice(0, 10) : new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10));

// umsaetze: [{ buchungsdatum, betrag_cent }] → [{ monat: 'YYYY-MM', ein_cent, aus_cent }] aufsteigend, ohne Lücken
export function monatsSummen(umsaetze) {
  const m = new Map();
  for (const u of umsaetze) {
    const k = tag(u.buchungsdatum).slice(0, 7);
    const e = m.get(k) ?? { monat: k, ein_cent: 0, aus_cent: 0 };
    if (u.betrag_cent > 0) e.ein_cent += u.betrag_cent; else e.aus_cent -= u.betrag_cent;
    m.set(k, e);
  }
  const keys = [...m.keys()].sort();
  if (!keys.length) return [];
  const aus = [];
  for (let [j, mo] = keys[0].split('-').map(Number); ; mo++) {
    if (mo > 12) { j++; mo = 1; }
    const k = `${j}-${String(mo).padStart(2, '0')}`;
    aus.push(m.get(k) ?? { monat: k, ein_cent: 0, aus_cent: 0 });
    if (k === keys.at(-1)) return aus;
  }
}

// Tagessaldo am Ende jedes Buchungstages, rückwärts vom bekannten Saldo (saldo_cent am saldo_datum) gerechnet.
// Ohne bekannten Saldo: null.
export function kontoverlauf(umsaetze, saldo_cent, saldo_datum) {
  if (saldo_cent == null || !saldo_datum) return null;
  const ende = tag(saldo_datum);
  const jeTag = new Map();
  for (const u of umsaetze) { const d = tag(u.buchungsdatum); jeTag.set(d, (jeTag.get(d) ?? 0) + u.betrag_cent); }
  const tage = [...new Set([...jeTag.keys(), ende])].sort().reverse();
  let s = Number(saldo_cent);
  const aus = [];
  for (const d of tage) {
    if (d > ende) continue; // Buchungen nach dem Saldodatum sind im Saldo nicht enthalten
    aus.push({ datum: d, saldo_cent: s });
    s -= jeTag.get(d) ?? 0;
  }
  return aus.reverse();
}
