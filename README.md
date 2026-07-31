# AS/400 Db2-for-i Systemwache

**Version:** 1.2.0 — siehe [CHANGELOG.md](CHANGELOG.md) für die vollständige Versionshistorie.

Analysiert Datenbankprobleme (Sperren, blockierte Transaktionen, SQL-Fehler)
auf einer AS/400 (IBM i) und lässt Claude priorisierte Lösungsvorschläge
generieren. Ausgabe als Web-Dashboard.

## Projektstruktur

```
.
├── backend/                    npm-Projekt (Server + Dashboard)
│   ├── lib/                    Mapepire-Anbindung, SQL-Queries, Claude-Integration
│   ├── public/index.html       Dashboard (statisch ausgeliefert)
│   ├── package.json            Version, Skripte, Abhängigkeiten
│   ├── eslint.config.js        Linting
│   ├── .prettierrc.json        Formatierung
│   └── .env.example            Konfigurationsvorlage
├── .github/
│   ├── workflows/ci.yml        Syntax-Check, Lint, Format-Check, npm audit
│   ├── workflows/fly-deploy.yml  Auto-Deploy nach Fly.io bei Push auf main
│   ├── PULL_REQUEST_TEMPLATE.md
│   └── ISSUE_TEMPLATE/bug_report.md
├── fly.toml                    Fly.io-Deployment-Konfiguration
├── CHANGELOG.md                Versionshistorie (Keep a Changelog / SemVer)
├── CONTRIBUTING.md             Branch-/Commit-/Versionierungs-Konventionen
├── SECURITY.md                 Sicherheits-Policy, unterstützte Versionen
├── LICENSE
├── Dockerfile / docker-compose.yml
├── .editorconfig / .nvmrc      konsistente Formatierung & Node-Version
└── .gitignore
```

## Architektur

```
Browser (Dashboard)
     │  GET /api/analyze
     ▼
Express Server (Node.js)
     │
     ├─► Mapepire (WebSocket, Port 8076) ──► Db2 for i (QSYS2 SQL Services)
     │        liest: Sperren, Transaktionen, SQL-Fehler aus Job-Logs
     │
     └─► Claude API ──► strukturierte Problem-/Lösungsliste (JSON)
```

## Voraussetzungen

1. **Mapepire-Server auf der AS/400 installieren** (einmalig, durch den
   IBM-i-Administrator). Anleitung: https://mapepire-ibmi.github.io/guides/sysadmin/
   Läuft standardmäßig auf Port 8076, verschlüsselt.
2. Ein IBM-i-Benutzerprofil mit Leserechten auf die QSYS2-Services.
3. Node.js 18+ und ein Anthropic-API-Key.

## Setup

```bash
cd backend
npm install
cp .env.example .env
# .env mit AS400_HOST, AS400_USER, AS400_PASSWORD, ANTHROPIC_API_KEY füllen
npm start
```

Danach im Browser: http://localhost:3000

## Verwendete Db2-for-i SQL Services

| Service | Zweck |
|---|---|
| `QSYS2.OBJECT_LOCK_INFO` | wartende Objekt-/Datensatzsperren |
| `QSYS2.DB_TRANSACTION_INFO` | offene Transaktionen inkl. Wartezeit |
| `QSYS2.SQL_STATEMENT_INFO` | aktuell laufende SQL-Anweisungen mit Fehlerstatus |
| `QSYS2.JOB_LOG_INFO('*')` | Job-Log-Nachrichten, gefiltert auf `SQL%`-Meldungen |

Je nach IBM-i-Release/Technology-Refresh können Spalten leicht abweichen —
mit `SELECT * FROM QSYS2.SYSVIEWS WHERE VIEW_NAME LIKE '%LOCK%'` prüfen,
welche Services auf dem jeweiligen System verfügbar sind.

## Entwicklung & Tooling

```bash
cd backend
npm install
npm run check          # Syntax-Check
npm run lint            # ESLint
npm run format           # Prettier (schreibt)
npm run format:check     # Prettier (nur pruefen)
```

CI (`.github/workflows/ci.yml`) führt bei jedem Push/PR auf `main` denselben
Check-, Lint- und Format-Durchlauf plus `npm audit` aus.

### Mit Docker (lokal)

```bash
docker compose build
docker compose up
```

Der App-Container publiziert standardmäßig **keinen** Port am Host — nur
über einen Reverse-Proxy im selben Docker-Netzwerk erreichbar (siehe
Kommentare in `docker-compose.yml` und `Dockerfile`).

### Deployment auf Fly.io

Konfiguration liegt in `fly.toml`. Wichtig: `min_machines_running = 1`,
damit mindestens eine Maschine dauerhaft läuft und der
Mapepire-Verbindungspool nicht bei jedem Request neu aufgebaut werden muss
(deshalb fiel die Wahl auf Fly.io statt Vercel/Serverless).

**Einmaliges Setup:**

```bash
flyctl auth login
flyctl launch --no-deploy   # erkennt fly.toml, KEIN erneutes Anlegen der App-Konfig nötig
flyctl secrets set \
  AS400_HOST=deine-as400.firma.local \
  AS400_USER=DEIN_PROFIL \
  AS400_PASSWORD=DEIN_PASSWORT \
  ANTHROPIC_API_KEY=sk-ant-... \
  API_KEY=$(openssl rand -hex 32)
flyctl deploy
```

**Automatisches Deployment bei Push auf `main`:**
`.github/workflows/fly-deploy.yml` deployed automatisch, sobald folgendes
GitHub-Repo-Secret gesetzt ist (Repo → Settings → Secrets and variables →
Actions):

- `FLY_API_TOKEN` — erzeugen mit `flyctl tokens create deploy`

**Wichtig:** Die AS/400 muss vom Fly.io-Netzwerk aus erreichbar sein (Port
8076, Mapepire). Bei einer AS/400 im internen Firmennetz ohne öffentliche
Erreichbarkeit ist dafür in der Regel ein Site-to-Site-VPN oder ein
WireGuard-Tunnel zwischen Fly.io und dem Firmennetz nötig
(`flyctl wireguard create`) — reines Deployment auf Fly.io löst dieses
Netzwerkproblem nicht automatisch.

### Versionierung

Neue Änderungen zuerst unter `## [Unreleased]` in `CHANGELOG.md` eintragen,
bei einem Release in eine versionierte Sektion verschieben und
`"version"` in `backend/package.json` synchron halten. Details in
[CONTRIBUTING.md](CONTRIBUTING.md).

## Nächste Schritte / Ausbaumöglichkeiten

- **Polling/Live-Modus**: `/api/analyze` per Intervall aufrufen und die
  Karten im Dashboard automatisch aktualisieren.
- **Historie**: Snapshots in einer eigenen Tabelle ablegen, um Trends
  ("dieser Lock-Konflikt tritt jeden Montag um 9 Uhr auf") zu erkennen.
- **Benachrichtigungen**: bei `severity: "critical"` E-Mail/Slack/Teams-Webhook
  auslösen.
- **Auth**: aktuell ist die API offen — für den produktiven Einsatz Login
  (z. B. via IBM-i-Benutzerprofil oder SSO) ergänzen.
- **Weitere Problemklassen**: Performance (CPU/Speicher/Warteschlangen) und
  Job-/Batch-Fehler lassen sich mit denselben Bausteinen (weitere QSYS2-Views
  + zusätzlicher Analyse-Prompt) ergänzen.

## Sicherheit

### Was bereits gehärtet ist

| Risiko | Maßnahme |
|---|---|
| XSS über AS/400-Daten (Job-Namen, SQL-Text) im Dashboard | Frontend setzt alle dynamischen Werte ausschließlich per `textContent`, nie per `innerHTML`-Interpolation |
| Offene API ohne Zugriffsschutz | `x-api-key`-Pflicht auf allen `/api/*`-Routen (`crypto.timingSafeEqual`, kein Timing-Leak); Server startet ohne gesetzten `API_KEY` gar nicht erst |
| CORS komplett offen | Nur explizit in `ALLOWED_ORIGIN` freigegebene Origins werden akzeptiert |
| DoS / Kostenmissbrauch (AS/400-Verbindungen, Claude-API) | Rate Limiting (20 Anfragen / 15 Min pro IP) + 20-Sekunden-Cache auf `/api/analyze` |
| Fehlermeldungen leaken interne Details | Client bekommt generische Fehlermeldung, volle Details nur im Server-Log |
| Fehlende Security-Header | `helmet` mit restriktiver CSP (`default-src 'self'`, `object-src 'none'`, `frame-ancestors 'none'`) |
| Unbemerkte Man-in-the-Middle-Verbindung zur AS/400 | `AS400_IGNORE_UNAUTHORIZED` defaultet auf `false` (Zertifikatsprüfung aktiv) |
| Sensible Daten (Literalwerte in SQL-Text) an Drittanbieter-API | `redactLiterals()` in `lib/claude.js` ersetzt String-/Zahlen-Literale durch `?`, bevor der Snapshot an Claude geht |
| Zu weitreichende Berechtigungen des Service-Profils | Hinweis in `lib/queries.js`: `AS400_USER` nach Least-Privilege-Prinzip einrichten, kein `*ALLOBJ`/`*SECADM` |
| Server an alle Interfaces gebunden | Bindet standardmäßig an `127.0.0.1` (`HOST`-Env-Variable); nur über einen davorgeschalteten Reverse-Proxy erreichbar |

### Was du zusätzlich vor einem echten Produktivbetrieb tun solltest

- **Echtes Mehrbenutzer-Login** (SSO/OAuth oder Bindung an IBM-i-Benutzerprofile)
  statt eines einzelnen statischen API-Keys – der Key ist eine Basisabsicherung
  für interne/VPN-Umgebungen, kein vollwertiges Auth-System.
- **TLS terminieren**: Der Server bindet bewusst nur an `127.0.0.1`. Einen
  Reverse-Proxy (nginx, Caddy, Cloud-Loadbalancer) mit gültigem Zertifikat
  davorschalten.
- **Secrets-Manager** statt `.env`-Datei im Produktivbetrieb (Vault, AWS
  Secrets Manager, Azure Key Vault o. Ä.); `.env` ist bereits in `.gitignore`.
- **Mapepire-Server nicht öffentlich exponieren** – nur aus dem internen
  Netz/VPN erreichbar machen, idealerweise per Firewall-Regel auf den
  Applikationsserver beschränkt.
- **Audit-Logging**: Wer hat wann welche Analyse ausgelöst? Für Compliance
  in vielen Umgebungen relevant.
- **Zertifikats-Pinning** für die Mapepire-Verbindung statt `ignoreUnauthorized`,
  siehe `getCertificate()` in der Mapepire-Node.js-Doku.
- Falls die App später **Parameter von Nutzern entgegennimmt** (z. B. Filter
  nach Bibliothek/Job): immer über die `parameters`-Option von Mapepire
  binden, nie SQL-Strings zusammenbauen (Injection-Schutz).
