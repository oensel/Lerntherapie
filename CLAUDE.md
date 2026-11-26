# Lerntherapie-Manager

Praxisverwaltung für eine Lerntherapie-Praxis: Klienten, Termine und Kalender (auch mobil), Sitzungsdokumentation, Rechnungen und Mahnwesen, Zahlungsabgleich per FinTS, E-Mail (IMAP/SMTP), Ausgaben und EÜR-Auswertung für die Steuer. Läuft lokal auf dem Home-Server (Proxmox, Docker Compose), Zugriff von außen nur per VPN.

## Tech-Stack (Architektur nach Vorbild Hajime Pro)
- Node.js 26 LTS (ES-Module) + Express 5, Knex 3 als Query-Builder/Migrationen
- PostgreSQL 19 (Produktion: Container `postgres:19-alpine`; Entwicklung: `embedded-postgres`)
- Frontend: `public/index.html` + `public/js/app.js` (ES-Modul, Vanilla-JS, Hash-Routing, Ansichten in `V`), Stil in `public/css/app.css`; Kalender unter 760 px als Tagesliste. Ursprünglicher Entwurf: `docs/mockups/lernpraxis-ui.html`
- Terminarten & Beträge (`terminarten`, Einstellungen → „Terminarten & Beträge“): Name, übliche Dauer, Preis für die übliche Dauer, Ausfall- und Nichterscheinen-Betrag. Termine frieren Art und Beträge beim Anlegen ein; stattgefunden = Preis × reale ÷ übliche Dauer (`artBetrag`/`terminBetrag` in `rechnungsLogik.js`), Ausfall/Nichterscheinen = fester Betrag der Art. Termine ohne Art (Altbestand) rechnen mit den Sätzen der Therapie bzw. `einstellungen`. Genutzte Arten werden beim Entfernen nur ausgeblendet
- Oberfläche: „Einstellungen“ = Beträge, Terminarten, Praxis & Rechnung; „System“ = E-Mail, Rechnungseingang, FinTS
- Terminstatus: geplant | stattgefunden | abgesagt (≥ 24 h, kostenfrei) | ausgefallen | unentschuldigt (beide berechnet)
- Klient → mehrere Therapien (`therapien`), jede mit einem Zahler (`zahler`: meist Eltern/Elternteil, auch Jugendamt; Name, Anschrift, E-Mail) und eigenen Beträgen je Status (NULL = Standard aus `einstellungen`, 0 = nicht berechnen). Termine tragen `therapie_id`; Rechnungen je Therapie und Monat an deren Zahler
- Einstellungen Praxis/E-Mail/FinTS in der Anwendung (`konfiguration`, `src/services/konfigDienst.js`): überschreiben die `.env`, Passwörter/PIN AES-GCM-verschlüsselt mit `GEHEIM_SCHLUESSEL`, werden nie zurückgegeben; Dienste lesen sie bei jeder Verwendung neu
- Routen als Factories mit Knex-DI: `src/routes/*Routes.js` exportiert `getXRoutes(knex)`, gemountet in `src/app.js`
- Kontoumsätze: `lib-fints`, Abruf täglich 08:00/16:00 (`src/services/fintsAbruf.js`, `zeitplan.js`, `umsatzDienst.js`); neue Umsätze = `umsaetze.gesehen=false` → Zähler in der Navigation. Ersteinrichtung mit `npm run fints:test` (schreibt `data/fints-bankinfo.json`, der erste Abruf übernimmt sie in `fints_zustand`)
- Rechnungen: `src/services/rechnungsDienst.js` (Vorschau, Lauf am 3. (`LAUFTAG`) 06:00 für den Vormonat, Storno, Zahlungsabgleich nach jedem FinTS-Abruf über Rechnungsnummer im Verwendungszweck), Logik in `rechnungsLogik.js`, PDF mit `pdf-lib` (`rechnungPdf.js`, Praxisdaten aus `PRAXIS_*` in der `.env`). Positionen sind eingefroren, abgerechnete Termine tragen `rechnung_id`; Nummern `JJJJ-MM-NNN`
- Rechnungsausgang: erstellte, noch nicht versendete Rechnungen (offen, `versendet_am` NULL) werden in der Oberfläche geprüft und einzeln oder gesammelt (`POST /api/rechnungen/versand`) gesendet; `einstellungen.autoversand` = direkt nach dem Lauf senden (`src/services/rechnungsVersand.js`, `nachLauf`). Ohne E-Mail-Adresse oder bei Fehler bleibt die Rechnung im Ausgang
- Verlauf je Rechnung (`rechnungsVerlauf` in `rechnungsLogik.js`, im Detail unter Rechnungen): Erstellung, Versand inkl. Fehlversuche, Zahlungsfrist, Mahnungen mit Fristen, Zahlung/Storno (`storniert_am`) und nächste mögliche Mahnstufe
- Mahnwesen: Stufen Zahlungserinnerung → Mahnung → letzte Mahnung (`mahnungen`, `rechnungen.mahnstufe`); fällig, wenn Fälligkeit bzw. letzte Mahnfrist + `MAHN_KARENZ_TAGE` verstrichen ist; wird manuell ausgelöst, PDF je Mahnung
- E-Mail-Versand: `src/services/mailDienst.js` (`nodemailer`, SMTP aus `SMTP_*`/`MAIL_*` in der `.env`); Rechnung bzw. Mahnung als PDF-Anhang, Entwurf in der Oberfläche bearbeitbar, jeder Versuch in `mail_versand` protokolliert
- Überweisungs-QR-Code (EPC/GiroCode) auf Rechnung und Mahnung: `src/services/girocode.js` (`qrcode`), nur bei gültiger `PRAXIS_IBAN`; Verwendungszweck = Rechnungsnummer
- Rechnungseingang (Vorbild Dojo Pro): `src/services/eingangDienst.js` + `eingangLogik.js`, Seite „Belege“. Eigenes IMAP-Postfach (`RECHNUNG_IMAP_*`, Abruf alle 30 min, `EINGANG_ZEITPLAN=aus` schaltet ab) → je PDF/Bild-Anhang `eingangsrechnungen.status='neu'`; „Als Eingangsrechnung markieren“ → Gemini (`@google/genai`, `GEMINI_API_KEY` nur in der `.env` (nie in `konfiguration`), `GEMINI_MODELL` in den Einstellungen, PDF inline, JSON-Schema) liest Kopfdaten und Posten aus und ordnet jeden Posten (`eingangsrechnung_posten`, brutto) einer EÜR-Kategorie aus `KATEGORIEN` zu; EÜR-Übersicht nach Zahlungsdatum
- DATEV-Export (`src/services/datevLogik.js` + `datevDienst.js`, `GET /api/datev/:jahr[?datei]`, Button in der EÜR-Übersicht): Buchungsstapel EXTF 700/Format 13, Windows-1252, nur Pflichtspalten bis Buchungstext. Einnahmen = bezahlte Rechnungen nach `bezahlt_am`, aufgeteilt in Honorar/Ausfall/Mahngebühr; Ausgaben je Posten wie die EÜR-Übersicht. Konten in `konfiguration` (`DATEV_*`, Reiter Einstellungen → DATEV), leer = SKR03/SKR04-Vorschlag
- Lokale Entwicklungs-DB ist WIN1252: keine Zeichen wie „→“ in Texten, die in die DB geschrieben werden
- Geplant: Posteingang der Praxis (IMAP_*), JWT-Login

## Commands
- `npm run pg:start` — lokales PostgreSQL (Daten in `data/pg-lokal`, Port aus `DB_PORT` in `.env`)
- `npm run migrate` — Migrationen (`migrations/`, `knexfile.cjs`)
- `npm run dev` — Server mit Watch, Port 3000 (`FINTS_ZEITPLAN=aus` in der `.env` für die Entwicklung)
- `npm run demo:daten` — Beispiel-Klienten und Termine um die aktuelle Woche (nur bei leerer Datenbank)
- `docker compose up -d --build` — Produktion (App + DB, migriert automatisch)

## Arbeitsregeln
- Jede Änderung in einem eigenen Branch (`git switch -c <typ>/<thema>`), nie direkt auf `main`
- Geldbeträge immer als Integer in Cent
