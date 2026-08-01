import "dotenv/config";
import crypto from "node:crypto";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { collectDbHealthSnapshot, DEMO_MODE } from "./lib/queries.js";
import { analyzeSnapshot } from "./lib/claude.js";

// --- Startup-Validierung: ohne API_KEY starten wir bewusst nicht ---
if (!process.env.API_KEY || process.env.API_KEY.length < 16) {
  console.error(
    "FEHLER: API_KEY fehlt oder ist zu kurz (min. 16 Zeichen). " +
    "In .env setzen, z.B. mit: openssl rand -hex 32"
  );
  process.exit(1);
}

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1); // korrekt hinter Reverse-Proxy/Load-Balancer (Rate-Limit/IP)

// --- Security-Header (CSP erlaubt bewusst nur 'self' + inline fuer dieses
// Single-File-Dashboard; in einer groesseren Ausbaustufe auf externe
// JS/CSS-Dateien + Nonce umstellen) ---
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
        imgSrc: ["'self'", "data:"],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        frameAncestors: ["'none'"],
      },
    },
    crossOriginResourcePolicy: { policy: "same-origin" },
  })
);

// --- CORS: standardmaessig nur gleicher Origin. Fuer Cross-Origin-Zugriff
// (z.B. separates Frontend-Deployment) ALLOWED_ORIGIN in .env setzen. ---
const allowedOrigins = (process.env.ALLOWED_ORIGIN || "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
      callback(new Error("Nicht erlaubter Origin"));
    },
  })
);

app.use(express.static("public"));

// --- Authentifizierung fuer alle /api Routen ---
// Hinweis: Ein statischer API-Key ist eine Basis-Absicherung fuer
// interne/VPN-Umgebungen. Fuer produktiven Einsatz mit mehreren Nutzern
// echtes Login (SSO/OAuth, IBM-i-Benutzerprofil-Bindung) vorschalten.
function requireApiKey(req, res, next) {
  const provided = req.get("x-api-key");
  const expected = process.env.API_KEY;

  const providedBuf = Buffer.from(provided || "", "utf8");
  const expectedBuf = Buffer.from(expected, "utf8");

  const valid =
    providedBuf.length === expectedBuf.length &&
    crypto.timingSafeEqual(providedBuf, expectedBuf);

  if (!valid) {
    return res.status(401).json({ error: "Nicht autorisiert" });
  }
  next();
}

// --- Rate Limiting: schuetzt AS/400-Verbindungspool und Claude-API-Budget
// vor Missbrauch/DoS ---
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Zu viele Anfragen. Bitte spaeter erneut versuchen." },
});

// --- Kurzer In-Memory-Cache, damit ein Klick-Spam nicht bei jedem Aufruf
// erneut AS/400-Abfragen + Claude-Aufrufe ausloest ---
const CACHE_TTL_MS = 20_000;
let cache = { at: 0, payload: null };

app.use("/api", apiLimiter, requireApiKey);

app.get("/api/analyze", async (req, res) => {
  try {
    if (cache.payload && Date.now() - cache.at < CACHE_TTL_MS) {
      return res.json(cache.payload);
    }
    const snapshot = await collectDbHealthSnapshot();
    const issues = await analyzeSnapshot(snapshot);
    const payload = { snapshot, issues };
    cache = { at: Date.now(), payload };
    res.json(payload);
  } catch (err) {
    // Volle Fehlerdetails nur ins Server-Log, niemals an den Client
    console.error("[/api/analyze]", err);
    res.status(502).json({ error: "Analyse fehlgeschlagen. Details siehe Server-Log." });
  }
});

app.get("/api/snapshot", async (req, res) => {
  try {
    const snapshot = await collectDbHealthSnapshot();
    res.json(snapshot);
  } catch (err) {
    console.error("[/api/snapshot]", err);
    res.status(502).json({ error: "Snapshot fehlgeschlagen. Details siehe Server-Log." });
  }
});

// Kein Auth noetig: erlaubt dem Dashboard, den Demo-Banner ohne API-Key anzuzeigen.
app.get("/api/health", (req, res) => res.json({ ok: true, demoMode: DEMO_MODE }));

// Generischer Fehler-Handler (faengt z.B. CORS-Fehler ab, statt Stacktraces zu leaken)
app.use((err, req, res, next) => {
  console.error("[unhandled]", err);
  res.status(500).json({ error: "Interner Fehler" });
});

const port = process.env.PORT || 3000;
// Default: nur localhost erreichbar (sicher fuer Bare-Metal/VM-Betrieb mit
// Reverse-Proxy auf derselben Maschine). In Container-Setups, in denen der
// Reverse-Proxy in einem eigenen Container laeuft, HOST=0.0.0.0 setzen UND
// sicherstellen, dass der Container-Port NICHT direkt am Host publiziert
// wird (nur ueber das interne Docker-Netzwerk vom Proxy erreichbar) - siehe
// docker-compose.yml.
const host = process.env.HOST || "127.0.0.1";
app.listen(port, host, () => {
  console.log(`AS/400 DB-Monitor Backend laeuft auf http://${host}:${port}`);
  if (host === "127.0.0.1") {
    console.log("Hinweis: bindet nur an localhost. Fuer Netzwerkzugriff einen TLS-terminierenden Reverse-Proxy davorschalten.");
  }
});
