/**
 * Erzeugt einen plausiblen, aber komplett erfundenen DB-Health-Snapshot fuer
 * DEMO_MODE=true. Damit laesst sich das Dashboard (inkl. echter Claude-
 * Analyse) live vorfuehren, ohne dass eine AS/400 erreichbar sein oder
 * echte Firmendaten verlassen muessen. Bei jedem Aufruf leicht variiert,
 * damit ein wiederholter Klick nicht immer exakt dasselbe zeigt.
 */
function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomJobName(i) {
  const subsystems = ["QINTER", "QBATCH", "QSYSWRK"];
  return `${String(100000 + i).slice(-6)}/DEMOUSR/${pick(subsystems)}`;
}

export function generateDemoSnapshot() {
  const locks = [
    {
      OBJECT_LIBRARY: "VERTRIEB",
      OBJECT_NAME: "AUFTKOPF",
      OBJECT_TYPE: "*FILE",
      LOCK_STATE: "*EXCL",
      LOCK_STATUS: "WAITING",
      JOB_NAME: randomJobName(1),
      MEMBER_NAME: "AUFTKOPF",
    },
    {
      OBJECT_LIBRARY: "VERTRIEB",
      OBJECT_NAME: "AUFTPOS",
      OBJECT_TYPE: "*FILE",
      LOCK_STATE: "*SHRUPD",
      LOCK_STATUS: "WAITING",
      JOB_NAME: randomJobName(2),
      MEMBER_NAME: "AUFTPOS",
    },
  ];

  const transactions = [
    {
      JOB_NAME: randomJobName(1),
      TRANSACTION_STATE: "ACTIVE",
      SQL_STATEMENT_TEXT: "UPDATE VERTRIEB.AUFTKOPF SET STATUS = ? WHERE AUFTNR = ?",
      LOCK_OBJECT_NAME: "AUFTKOPF",
      LOCK_STATE: "*EXCL",
      WAIT_ELAPSED_TIME: 30000 + Math.floor(Math.random() * 60000),
    },
    {
      JOB_NAME: randomJobName(3),
      TRANSACTION_STATE: "ACTIVE",
      SQL_STATEMENT_TEXT: "SELECT * FROM VERTRIEB.AUFTPOS WHERE AUFTNR = ? FOR UPDATE",
      LOCK_OBJECT_NAME: "AUFTPOS",
      LOCK_STATE: "*SHRUPD",
      WAIT_ELAPSED_TIME: 5000 + Math.floor(Math.random() * 20000),
    },
  ];

  const statements = [
    {
      JOB_NAME: randomJobName(4),
      SQL_STATEMENT_TEXT: "SELECT * FROM LAGER.BESTAND WHERE ARTIKELNR = ?",
      ELAPSED_TOTAL_TIME: 12000 + Math.floor(Math.random() * 8000),
      ESTIMATED_COST: 4200,
      SQL_STATE: "01000",
    },
  ];

  const errors = [
    {
      ORDINAL_POSITION: 1,
      MESSAGE_ID: "SQL0913",
      MESSAGE_TIMESTAMP: new Date(Date.now() - 60_000).toISOString(),
      MESSAGE_TEXT: "Zeilen- oder Objektsperren ueber alle Sperrraeume hinweg erreicht.",
      SEVERITY: 40,
      FROM_JOB: randomJobName(1),
    },
    {
      ORDINAL_POSITION: 2,
      MESSAGE_ID: "SQL0904",
      MESSAGE_TIMESTAMP: new Date(Date.now() - 300_000).toISOString(),
      MESSAGE_TEXT: "Resource nicht verfuegbar wegen Sperrenkonflikt.",
      SEVERITY: 30,
      FROM_JOB: randomJobName(2),
    },
  ];

  return {
    timestamp: new Date().toISOString(),
    locks,
    transactions,
    statements,
    errors,
  };
}
