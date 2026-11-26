import { holeUmsaetze } from './fintsAbruf.js';
import { starteTagesplan } from './zeitplan.js';

// Abrufzeiten der Kontoumsätze, z.B. FINTS_ABRUFZEITEN=08:00,16:00
export const STANDARD_ABRUFZEITEN = ['08:00', '16:00'];

// Höchstens ein Abruf gleichzeitig (Zeitplan und Knopf „Jetzt abrufen“ teilen sich die Sperre)
export function erstelleUmsatzDienst(knex, { env = process.env, werte = async () => env, log = console, abruf = holeUmsaetze, nachAbruf } = {}) {
  let laufend = null;

  function starteAbruf(ausloeser) {
    if (!laufend) {
      laufend = werte().then((aktuell) => abruf(knex, { env: aktuell, ausloeser, log }))
        .then(async (e) => { if (nachAbruf) await nachAbruf().catch((f) => log.error?.('Nach dem Abruf:', f)); return e; })
        .finally(() => { laufend = null; });
    }
    return laufend;
  }

  function starteZeitplan() {
    const zeiten = env.FINTS_ABRUFZEITEN ? env.FINTS_ABRUFZEITEN.split(',').map((s) => s.trim()) : STANDARD_ABRUFZEITEN;
    return starteTagesplan('Kontoumsätze', zeiten, () => starteAbruf('zeitplan'), log);
  }

  return { starteAbruf, starteZeitplan, laeuft: () => !!laufend };
}
