import { Router } from 'express';
import nodemailer from 'nodemailer';
import { smtpAusEnv } from '../services/mailDienst.js';

// Einstellungen für Praxis, E-Mail und FinTS aus der Anwendung. Passwörter/PIN werden nie zurückgegeben.
export function getKonfigRoutes(konfig) {
  const r = Router();

  r.get('/', async (_req, res) => res.json(await konfig.fuerAnzeige()));

  r.put('/', async (req, res) => {
    await konfig.speichern(req.body);
    res.json(await konfig.fuerAnzeige());
  });

  r.get('/logo', async (_req, res) => {
    const m = /^data:(image\/\w+);base64,(.*)$/.exec((await konfig.wirksam()).PRAXIS_LOGO ?? '');
    if (!m) return res.status(404).end();
    res.type(m[1]).send(Buffer.from(m[2], 'base64'));
  });
  r.put('/logo', async (req, res) => { await konfig.logoSetzen(req.body?.daten); res.json(await konfig.fuerAnzeige()); });
  r.delete('/logo', async (_req, res) => { await konfig.logoSetzen(null); res.json(await konfig.fuerAnzeige()); });

  // Prüft Anmeldung am SMTP-Server mit den gespeicherten Werten (ohne eine Mail zu senden)
  r.post('/mail-test', async (_req, res) => {
    const smtp = smtpAusEnv(await konfig.wirksam());
    if (!smtp) return res.status(400).json({ fehler: 'Kein Postausgangsserver eingetragen' });
    try {
      await nodemailer.createTransport({ ...smtp.transport, connectionTimeout: 10_000 }).verify();
      res.json({ ok: true });
    } catch (e) {
      res.status(502).json({ fehler: `Verbindung fehlgeschlagen: ${e.message}` });
    }
  });

  return r;
}
