import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-4-6";

/**
 * Entfernt String- und Zahlen-Literale aus SQL-/Fehlertext, bevor er das
 * System verlaesst (z.B. an die Claude API gesendet wird). Fuer die Analyse
 * wird nur die Struktur/das Muster der Anweisung benoetigt, nicht die
 * tatsaechlichen (moeglicherweise sensiblen Geschaefts-) Werte.
 * "WHERE KUNDENNR = 12345 AND NAME = 'Mueller'" -> "WHERE KUNDENNR = ? AND NAME = ?"
 */
function redactLiterals(text) {
  if (typeof text !== "string") return text;
  return text
    .replace(/'(?:[^']|'')*'/g, "?") // String-Literale (inkl. escaped '')
    .replace(/\b\d+(\.\d+)?\b/g, "?"); // numerische Literale
}

function redactSnapshot(snapshot) {
  const redactField = (rows, field) =>
    (rows || []).map((r) => ({ ...r, [field]: redactLiterals(r[field]) }));

  return {
    ...snapshot,
    transactions: redactField(snapshot.transactions, "SQL_STATEMENT_TEXT"),
    statements: redactField(snapshot.statements, "SQL_STATEMENT_TEXT"),
    errors: redactField(snapshot.errors, "MESSAGE_TEXT"),
  };
}

const SYSTEM_PROMPT = `Du bist ein erfahrener Db2-for-i (AS/400) Datenbankadministrator.
Du erhaeltst einen JSON-Snapshot mit aktiven Sperren, wartenden Transaktionen,
lang laufenden SQL-Anweisungen und aktuellen SQL-Fehlermeldungen aus Job-Logs.

Analysiere die Daten und identifiziere konkrete Probleme (z.B. Lock-Waits,
Deadlock-Risiken, wiederkehrende SQL-Fehlercodes, blockierende Job-Ketten).

Antworte AUSSCHLIESSLICH mit einem JSON-Array (keine Erklaerung, kein Markdown,
keine Code-Fences), wobei jedes Element folgendes Schema hat:
{
  "id": "kurzer eindeutiger Code, z.B. SQL0913-01",
  "severity": "critical" | "warning" | "info",
  "title": "kurzer Titel des Problems auf Deutsch",
  "affected": "betroffene Objekte/Jobs als kurzer String",
  "explanation": "verstaendliche Erklaerung der Ursache auf Deutsch",
  "suggestion": "konkrete, umsetzbare Loesungsempfehlung auf Deutsch",
  "confidence": Zahl zwischen 0 und 1
}
Wenn keine Probleme erkennbar sind, gib ein leeres Array [] zurueck.`;

/**
 * Schickt den DB-Snapshot an die Claude API und erhaelt eine strukturierte
 * Liste priorisierter Probleme samt Loesungsvorschlaegen zurueck.
 */
export async function analyzeSnapshot(snapshot) {
  const safeSnapshot = redactSnapshot(snapshot);

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 4000,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: `Snapshot:\n${JSON.stringify(safeSnapshot)}`,
      },
    ],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  const raw = (textBlock?.text || "[]").trim();
  const cleaned = raw.replace(/^```json\s*|```$/g, "");

  try {
    return JSON.parse(cleaned);
  } catch (err) {
    console.error("Konnte Claude-Antwort nicht parsen:", raw);
    throw new Error("KI-Analyse lieferte kein gueltiges JSON zurueck");
  }
}
