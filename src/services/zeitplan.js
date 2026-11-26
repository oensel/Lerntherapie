// Einfacher Tageszeitplan ohne Zusatzpaket: führt eine Aufgabe täglich zu festen Uhrzeiten aus (lokale Zeit des Servers,
// im Container über TZ=Europe/Berlin). Verpasste Zeitpunkte (Server aus) werden nicht nachgeholt.

// Nächster Zeitpunkt nach `jetzt` für Uhrzeiten wie ['08:00', '16:00']
export function naechsterZeitpunkt(uhrzeiten, jetzt = new Date()) {
  const kandidaten = [];
  for (const tag of [0, 1]) {
    for (const u of uhrzeiten) {
      const [h, m] = u.split(':').map(Number);
      const d = new Date(jetzt);
      d.setDate(d.getDate() + tag);
      d.setHours(h, m, 0, 0);
      if (d > jetzt) kandidaten.push(d);
    }
  }
  return kandidaten.sort((a, b) => a - b)[0];
}

export function starteTagesplan(name, uhrzeiten, aufgabe, log = console) {
  let timer;
  let laeuft = false;
  const planen = () => {
    const wann = naechsterZeitpunkt(uhrzeiten);
    log.info?.(`Zeitplan „${name}“: nächster Lauf ${wann.toLocaleString('de-DE')}`);
    timer = setTimeout(async () => {
      if (!laeuft) {
        laeuft = true;
        try { await aufgabe(); } catch { /* Fehler protokolliert die Aufgabe selbst */ }
        laeuft = false;
      }
      planen();
    }, wann - Date.now());
  };
  planen();
  return { stopp: () => clearTimeout(timer) };
}
