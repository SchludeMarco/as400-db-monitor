/**
 * Sammlung von Db2-for-i "SQL Services" Abfragen (QSYS2-Schema).
 * Diese Views/Table-Functions liefern Echtzeit-Systeminformationen ohne
 * zusaetzliche Treiber oder Exit-Programme.
 *
 * Hinweis: Je nach IBM i Release/Technology Refresh koennen einzelne
 * Spalten abweichen. Bei Bedarf mit "SELECT * FROM QSYS2.SYSVIEWS
 * WHERE VIEW_NAME LIKE '%LOCK%'" pruefen, welche Services verfuegbar sind.
 */
import { runQuery } from "./db.js";
import { generateDemoSnapshot } from "./demoData.js";

export const DEMO_MODE = process.env.DEMO_MODE === "true";

// Aktive Sperren auf Objekt-/Datensatzebene inkl. wartender Jobs
export async function getObjectLocks() {
  return runQuery(`
    SELECT
      OBJECT_LIBRARY,
      OBJECT_NAME,
      OBJECT_TYPE,
      LOCK_STATE,
      LOCK_STATUS,
      JOB_NAME,
      MEMBER_NAME
    FROM QSYS2.OBJECT_LOCK_INFO
    WHERE LOCK_STATUS = 'WAITING'
    ORDER BY OBJECT_LIBRARY, OBJECT_NAME
    FETCH FIRST 200 ROWS ONLY
  `);
}

// Offene Transaktionen inkl. Sperrwartezeit -> zeigt Blocker-/Wartende-Job-Ketten
export async function getTransactionInfo() {
  return runQuery(`
    SELECT
      JOB_NAME,
      TRANSACTION_STATE,
      SQL_STATEMENT_TEXT,
      LOCK_OBJECT_NAME,
      LOCK_STATE,
      WAIT_ELAPSED_TIME
    FROM QSYS2.DB_TRANSACTION_INFO
    WHERE WAIT_ELAPSED_TIME > 0
    ORDER BY WAIT_ELAPSED_TIME DESC
    FETCH FIRST 100 ROWS ONLY
  `);
}

// Aktuell laufende SQL-Anweisungen (fuer Kontext, z.B. teure/lang laufende Statements)
export async function getActiveStatements() {
  return runQuery(`
    SELECT
      JOB_NAME,
      SQL_STATEMENT_TEXT,
      ELAPSED_TOTAL_TIME,
      ESTIMATED_COST,
      SQL_STATE
    FROM QSYS2.SQL_STATEMENT_INFO
    WHERE SQL_STATE IS NOT NULL AND SQL_STATE <> '00000'
    ORDER BY ELAPSED_TOTAL_TIME DESC
    FETCH FIRST 100 ROWS ONLY
  `);
}

// Fehlermeldungen aus Job-Logs, gefiltert auf SQL-relevante Nachrichten (Message-ID beginnt mit SQL).
//
// Sicherheitshinweis (Least Privilege): JOB_LOG_INFO('*') liest potenziell
// Job-Logs ueber Berechtigungsgrenzen hinweg, abhaengig von den Rechten des
// verbindenden Profils. Das AS400_USER-Profil sollte NICHT *ALLOBJ/*SECADM
// besitzen, sondern nur die minimal noetigen Rechte (Lesezugriff auf die
// relevanten QSYS2-Services). Wo sinnvoll auf ein konkretes Subsystem/eine
// konkrete Job-Queue einschraenken statt '*'.
export async function getRecentSqlErrors() {
  return runQuery(`
    SELECT
      ORDINAL_POSITION,
      MESSAGE_ID,
      MESSAGE_TIMESTAMP,
      MESSAGE_TEXT,
      SEVERITY,
      FROM_JOB
    FROM TABLE(QSYS2.JOB_LOG_INFO('*')) AS X
    WHERE MESSAGE_ID LIKE 'SQL%'
      AND SEVERITY >= 30
    ORDER BY MESSAGE_TIMESTAMP DESC
    FETCH FIRST 100 ROWS ONLY
  `);
}

// Gesamtbild sammeln - wird an die KI-Analyse uebergeben
export async function collectDbHealthSnapshot() {
  const [locks, transactions, statements, errors] = await Promise.all([
    getObjectLocks(),
    getTransactionInfo(),
    getActiveStatements(),
    getRecentSqlErrors(),
  ]);

  return {
    timestamp: new Date().toISOString(),
    locks,
    transactions,
    statements,
    errors,
  };
}
