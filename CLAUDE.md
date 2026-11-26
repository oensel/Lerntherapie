# Lerntherapie-Manager

Praxisverwaltung für eine Lerntherapie-Praxis: Klienten, Termine und Kalender (auch mobil), Sitzungsdokumentation, Rechnungen und Mahnwesen, Zahlungsabgleich per FinTS, E-Mail (IMAP/SMTP), Ausgaben und EÜR-Auswertung für die Steuer. Läuft lokal auf dem Home-Server (Proxmox, Docker Compose), Zugriff von außen nur per VPN.

## Tech-Stack (Architektur nach Vorbild Hajime Pro)
- Node.js 26 LTS (ES-Module) + Express 5, Knex 3 als Query-Builder/Migrationen
- PostgreSQL 19 (Produktion: Container `postgres:19-alpine`; Entwicklung: `embedded-postgres`)
- Frontend: statische Seiten in `public/` + Vanilla-JS; UI-Entwurf in `docs/mockups/lernpraxis-ui.html`
- Routen als Factories mit Knex-DI: `src/routes/*Routes.js` exportiert `getXRoutes(knex)`, gemountet in `src/app.js`
- Geplant: `lib-fints` (Kontoumsätze), `imapflow` + `nodemailer` (Mail), `pdf-lib` (Rechnungen), JWT-Login

## Commands
- `npm run pg:start` — lokales PostgreSQL (Daten in `data/pg-lokal`, Port aus `DB_PORT` in `.env`)
- `npm run migrate` — Migrationen (`migrations/`, `knexfile.cjs`)
- `npm run dev` — Server mit Watch, Port 3000
- `docker compose up -d --build` — Produktion (App + DB, migriert automatisch)

## Arbeitsregeln
- Jede Änderung in einem eigenen Branch (`git switch -c <typ>/<thema>`), nie direkt auf `main`
- Geldbeträge immer als Integer in Cent
