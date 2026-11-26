# Lerntherapie-Manager

Praxisverwaltung für eine Lerntherapie-Praxis: Klienten, Termine und Kalender (auch mobil), Sitzungsdokumentation, Rechnungen und Mahnwesen, Zahlungsabgleich per FinTS, E-Mail (IMAP/SMTP), Ausgaben und EÜR-Auswertung für die Steuer. Läuft lokal auf dem Home-Server (Proxmox, Docker Compose), Zugriff von außen nur per VPN.

## Tech-Stack (Architektur nach Vorbild Hajime Pro)
- Node.js 26 LTS (ES-Module) + Express 5, Knex 3 als Query-Builder/Migrationen
- PostgreSQL 19 (Produktion: Container `postgres:19-alpine`; Entwicklung: `embedded-postgres`)
- Frontend: `public/index.html` + `public/js/app.js` (ES-Modul, Vanilla-JS, Hash-Routing, Ansichten in `V`), Stil in `public/css/app.css`; Kalender unter 760 px als Tagesliste. Ursprünglicher Entwurf: `docs/mockups/lernpraxis-ui.html`
- Terminstatus: geplant | stattgefunden | abgesagt (≥ 24 h, kostenfrei) | ausgefallen | unentschuldigt (beide berechnet)
- Routen als Factories mit Knex-DI: `src/routes/*Routes.js` exportiert `getXRoutes(knex)`, gemountet in `src/app.js`
- Kontoumsätze: `lib-fints`, Abruf täglich 08:00/16:00 (`src/services/fintsAbruf.js`, `zeitplan.js`, `umsatzDienst.js`); neue Umsätze = `umsaetze.gesehen=false` → Zähler in der Navigation. Ersteinrichtung mit `npm run fints:test` (schreibt `data/fints-bankinfo.json`, der erste Abruf übernimmt sie in `fints_zustand`)
- Rechnungen: `src/services/rechnungsDienst.js` (Vorschau, Lauf am 1. 06:00 für den Vormonat, Storno, Zahlungsabgleich nach jedem FinTS-Abruf über Rechnungsnummer im Verwendungszweck), Logik in `rechnungsLogik.js`, PDF mit `pdf-lib` (`rechnungPdf.js`, Praxisdaten aus `PRAXIS_*` in der `.env`). Positionen sind eingefroren, abgerechnete Termine tragen `rechnung_id`; Nummern `JJJJ-MM-NNN`
- Mahnwesen: Stufen Zahlungserinnerung → Mahnung → letzte Mahnung (`mahnungen`, `rechnungen.mahnstufe`); fällig, wenn Fälligkeit bzw. letzte Mahnfrist + `MAHN_KARENZ_TAGE` verstrichen ist; wird manuell ausgelöst, PDF je Mahnung
- Geplant: `imapflow` + `nodemailer` (Mail, Rechnungs- und Mahnversand), JWT-Login

## Commands
- `npm run pg:start` — lokales PostgreSQL (Daten in `data/pg-lokal`, Port aus `DB_PORT` in `.env`)
- `npm run migrate` — Migrationen (`migrations/`, `knexfile.cjs`)
- `npm run dev` — Server mit Watch, Port 3000 (`FINTS_ZEITPLAN=aus` in der `.env` für die Entwicklung)
- `npm run demo:daten` — Beispiel-Klienten und Termine um die aktuelle Woche (nur bei leerer Datenbank)
- `docker compose up -d --build` — Produktion (App + DB, migriert automatisch)

## Arbeitsregeln
- Jede Änderung in einem eigenen Branch (`git switch -c <typ>/<thema>`), nie direkt auf `main`
- Geldbeträge immer als Integer in Cent
