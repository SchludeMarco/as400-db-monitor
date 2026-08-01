/**
 * Mapepire-Verbindung (WebSocket-Gateway zu Db2 for i). Ein einzelner Pool
 * wird lazy beim ersten Query aufgebaut und danach wiederverwendet, damit
 * nicht bei jedem HTTP-Request ein neuer WebSocket-Handshake noetig ist.
 *
 * Hinweis: API-Oberflaeche von @ibm/mapepire-js ist noch jung (0.x) und kann
 * sich zwischen Minor-Versionen aendern - bei Upgrade gegen die installierten
 * TypeScript-Typen in node_modules/@ibm/mapepire-js pruefen.
 */
import { Pool } from "@ibm/mapepire-js";

let pool;

function buildCreds() {
  return {
    host: process.env.AS400_HOST,
    port: Number(process.env.AS400_PORT || 8076),
    user: process.env.AS400_USER,
    password: process.env.AS400_PASSWORD,
    // Standard: Zertifikat wird geprueft (schuetzt vor Man-in-the-Middle).
    // Siehe Hinweis in .env.example / README zu getCertificate()-Pinning.
    ignoreUnauthorized: process.env.AS400_IGNORE_UNAUTHORIZED === "true",
  };
}

async function getPool() {
  if (!pool) {
    pool = new Pool({
      creds: buildCreds(),
      maxSize: Number(process.env.AS400_POOL_MAX_SIZE || 5),
      startingSize: Number(process.env.AS400_POOL_STARTING_SIZE || 1),
    });
    await pool.init();
  }
  return pool;
}

// Fuehrt eine SQL-Anweisung ueber den Mapepire-Pool aus und gibt die
// Ergebniszeilen zurueck. `parameters` immer ueber Mapepire binden (nie
// SQL-Strings zusammenbauen), siehe SECURITY.md.
export async function runQuery(sql, parameters = []) {
  const activePool = await getPool();
  const result = await activePool.execute(sql, { parameters });
  if (!result.success) {
    throw new Error(result.error || "Mapepire-Query fehlgeschlagen");
  }
  return result.data ?? [];
}

// Fuer sauberes Herunterfahren (z.B. SIGTERM in Container-Umgebungen).
export async function closePool() {
  if (pool) {
    await pool.end();
    pool = undefined;
  }
}
