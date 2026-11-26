import nodemailer from 'nodemailer';

const datum = (d) => new Date(d).toLocaleDateString('de-DE');
const eur = (c) => (c / 100).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
const monatName = (m) => { const [j, mo] = m.split('-').map(Number); return new Date(j, mo - 1, 1).toLocaleDateString('de-DE', { month: 'long', year: 'numeric' }); };

// SMTP aus der .env: SMTP_HOST, SMTP_PORT (587 STARTTLS / 465 TLS), SMTP_USER, SMTP_PASS, MAIL_ABSENDER, MAIL_BCC (Kopie an die Praxis)
export function smtpAusEnv(env = process.env) {
  if (!env.SMTP_HOST) return null;
  const port = Number(env.SMTP_PORT || 587);
  return {
    transport: { host: env.SMTP_HOST, port, secure: port === 465, auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined },
    absender: env.MAIL_ABSENDER || env.SMTP_USER,
    bcc: env.MAIL_BCC || undefined,
  };
}

// Vorschlag für Betreff und Text; die Oberfläche zeigt ihn zum Bearbeiten an
export function entwurfRechnung(r, praxisName) {
  return {
    betreff: `Rechnung ${r.nummer} – ${r.klient_name}, ${monatName(r.leistungsmonat)}`,
    text: `Guten Tag,\n\nanbei erhalten Sie die Rechnung ${r.nummer} für die ${r.therapie_bezeichnung || 'Lerntherapie'} von ${r.klient_name} im ${monatName(r.leistungsmonat)} über ${eur(r.betrag_cent)}.\n\nBitte überweisen Sie den Betrag bis zum ${datum(r.faellig_am)} unter Angabe der Rechnungsnummer.\n\nMit freundlichen Grüßen\n${praxisName}`,
  };
}

export function entwurfMahnung(r, m, art, offenCent, praxisName) {
  return {
    betreff: `${art} zu Rechnung ${r.nummer} – ${r.klient_name}`,
    text: `Guten Tag,\n\nfür die Rechnung ${r.nummer} vom ${datum(r.rechnungsdatum)} konnten wir bisher keinen Zahlungseingang feststellen. Anbei erhalten Sie unsere ${art}.\n\nBitte überweisen Sie den offenen Betrag von ${eur(offenCent)} bis zum ${datum(m.frist)}. Sollte sich Ihre Zahlung mit dieser Nachricht überschnitten haben, betrachten Sie sie bitte als gegenstandslos.\n\nMit freundlichen Grüßen\n${praxisName}`,
  };
}

// Liest die SMTP-Einstellungen bei jedem Versand neu (in der Anwendung änderbar, siehe konfigDienst)
export function erstelleMailDienst(knex, { werte = async () => process.env, transport } = {}) {
  async function verbindung() {
    const env = await werte();
    const smtp = smtpAusEnv(env);
    if (transport) return { versender: transport, absender: env.MAIL_ABSENDER, bcc: env.MAIL_BCC || undefined };
    if (!smtp) return null;
    return { versender: nodemailer.createTransport(smtp.transport), absender: smtp.absender, bcc: smtp.bcc };
  }

  // Sendet und protokolliert; wirft bei Fehlern weiter, nachdem der Fehlversuch protokolliert ist
  async function sende({ an, betreff, text, anhang, rechnung_id = null, mahnung_id = null }) {
    const v = await verbindung();
    if (!v) throw Object.assign(new Error('E-Mail-Versand ist nicht eingerichtet (Einstellungen → E-Mail)'), { status: 503, expose: true });
    try {
      const info = await v.versender.sendMail({
        from: v.absender, to: an, bcc: v.bcc, subject: betreff, text,
        attachments: anhang ? [{ filename: anhang.name, content: Buffer.from(anhang.daten), contentType: 'application/pdf' }] : [],
      });
      await knex('mail_versand').insert({ rechnung_id, mahnung_id, an, betreff, message_id: info.messageId ?? null });
      return info;
    } catch (e) {
      await knex('mail_versand').insert({ rechnung_id, mahnung_id, an, betreff, fehler: e.message });
      throw Object.assign(new Error(`Versand fehlgeschlagen: ${e.message}`), { status: 502, expose: true });
    }
  }

  return { sende, eingerichtet: async () => !!(await verbindung()) };
}
