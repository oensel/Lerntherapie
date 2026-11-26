import crypto from 'node:crypto';

// Einstellungen, die in der Anwendung geändert werden können. Gespeichert in `konfiguration` (Schlüssel/Wert);
// was dort fehlt, kommt aus der .env. Geheimnisse (Passwörter, PIN) werden mit AES-256-GCM verschlüsselt
// abgelegt und nie an die Oberfläche zurückgegeben. Schlüssel: GEHEIM_SCHLUESSEL (sonst JWT_SECRET) aus der .env.
export const FELDER = {
  praxis: [
    ['PRAXIS_NAME', 'Name der Praxis'], ['PRAXIS_ANSCHRIFT', 'Anschrift (Zeilen mit | trennen)'],
    ['PRAXIS_IBAN', 'IBAN'], ['PRAXIS_BIC', 'BIC'], ['PRAXIS_BANK', 'Bank'], ['PRAXIS_STEUERNR', 'Steuernummer'],
    ['PRAXIS_HINWEIS', 'Hinweis auf der Rechnung'],
  ],
  mail: [
    ['SMTP_HOST', 'Postausgangsserver (SMTP)'], ['SMTP_PORT', 'SMTP-Port (465 = SSL, 587 = STARTTLS)'], ['SMTP_USER', 'Benutzername'],
    ['SMTP_PASS', 'Passwort', true], ['MAIL_ABSENDER', 'Absender'], ['MAIL_BCC', 'Kopie an (BCC, optional)'],
    ['IMAP_HOST', 'Posteingangsserver (IMAP)'], ['IMAP_PORT', 'IMAP-Port'], ['IMAP_USER', 'IMAP-Benutzername'], ['IMAP_PASS', 'IMAP-Passwort', true],
  ],
  fints: [
    ['FINTS_URL', 'FinTS-Adresse der Bank'], ['FINTS_BLZ', 'Bankleitzahl'], ['FINTS_BENUTZER', 'Anmeldename / Legitimations-ID'],
    ['FINTS_KUNDEN_ID', 'Kunden-ID (falls abweichend)'], ['FINTS_PIN', 'PIN', true], ['FINTS_KONTO', 'Konto (IBAN, falls mehrere)'],
    ['FINTS_TAN_MEDIUM', 'pushTAN-Gerät'], ['FINTS_PRODUKT_ID', 'FinTS-Produkt-ID'],
  ],
};
const ALLE = Object.values(FELDER).flat();
const GEHEIM = new Set(ALLE.filter(([, , g]) => g).map(([k]) => k));
const ERLAUBT = new Set(ALLE.map(([k]) => k));

function schluessel(env) {
  const s = env.GEHEIM_SCHLUESSEL || env.JWT_SECRET;
  if (!s || s === 'bitte-aendern') return null;
  return crypto.scryptSync(s, 'lerntherapie-konfiguration', 32);
}

export function verschluesseln(text, key) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const daten = Buffer.concat([c.update(text, 'utf8'), c.final()]);
  return ['v1', iv.toString('base64'), c.getAuthTag().toString('base64'), daten.toString('base64')].join(':');
}

export function entschluesseln(wert, key) {
  const [, iv, tag, daten] = wert.split(':');
  const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
  d.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(daten, 'base64')), d.final()]).toString('utf8');
}

export function erstelleKonfigDienst(knex, { env = process.env } = {}) {
  const key = schluessel(env);

  // Wirksame Werte: .env, überschrieben durch die in der Anwendung gespeicherten Werte
  async function wirksam() {
    const zeilen = await knex('konfiguration').select('schluessel', 'wert');
    const aus = { ...env };
    for (const { schluessel: k, wert } of zeilen) {
      if (!GEHEIM.has(k)) { aus[k] = wert; continue; }
      if (!key) continue;
      try { aus[k] = entschluesseln(wert, key); } catch { /* falscher Schlüssel: .env-Wert bleibt */ }
    }
    return aus;
  }

  // Für die Oberfläche: Werte ohne Geheimnisse, bei Geheimnissen nur „gesetzt“
  async function fuerAnzeige() {
    const w = await wirksam();
    const werte = {};
    for (const [k] of ALLE) werte[k] = GEHEIM.has(k) ? { gesetzt: !!w[k] } : (w[k] ?? '');
    return { felder: FELDER, werte, verschluesselung: !!key };
  }

  // Speichert geänderte Werte. Geheimnisse: leer = unverändert lassen, null = löschen
  async function speichern(daten) {
    for (const [k, v] of Object.entries(daten ?? {})) {
      if (!ERLAUBT.has(k)) throw Object.assign(new Error(`Unbekannte Einstellung ${k}`), { status: 400, expose: true });
      if (GEHEIM.has(k)) {
        if (v === '' || v === undefined) continue;
        if (v === null) { await knex('konfiguration').where({ schluessel: k }).del(); continue; }
        if (!key) throw Object.assign(new Error('Zum Speichern von Passwörtern GEHEIM_SCHLUESSEL in der .env setzen'), { status: 400, expose: true });
        await upsert(k, verschluesseln(String(v), key));
      } else {
        await upsert(k, String(v ?? '').trim());
      }
    }
  }
  const upsert = (k, wert) => knex('konfiguration').insert({ schluessel: k, wert, aktualisiert_am: knex.fn.now() })
    .onConflict('schluessel').merge();

  return { wirksam, fuerAnzeige, speichern };
}
