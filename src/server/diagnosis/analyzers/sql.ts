import type { Diagnosis } from "@/server/domain/lab-tests";
import { splitSqlStatements } from "@/server/domain/code-analysis";

// Analyseur SQL spécialisé : constats DÉTERMINISTES tirés du message réel de SQLite et de la forme de la requête.
// Une confusion de notion (WHERE / HAVING…) reste une HYPOTHÈSE : confiance modérée, jamais présentée comme un fait.

const stripStrings = (sql: string) => sql.replace(/'(?:[^']|'')*'/g, "''").replace(/"(?:[^"]|"")*"/g, '""').replace(/--[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");

export function analyzeSqlAttempt(query: string, engineError?: { type?: string; message: string }): Diagnosis[] {
  const out: Diagnosis[] = [];
  const msg = engineError?.message ?? "";

  if (/misuse of aggregate/i.test(msg) || /aggregate functions are not allowed in the WHERE clause/i.test(msg)) {
    out.push({
      category: "CONCEPT",
      kind: "sql_where_having",
      confidence: 0.72,
      label: "Une fonction d'agrégation (COUNT, SUM, AVG…) est utilisée dans WHERE : WHERE filtre les lignes avant le regroupement, HAVING filtre les groupes après GROUP BY. Une confusion entre ces deux filtrages est possible.",
      tests: [],
    });
  }

  for (const st of splitSqlStatements(stripStrings(query))) {
    const t = st.text;
    if (/(=|<>|!=)\s*null\b/i.test(t) && /^(select|update|delete|with)\b/i.test(t)) {
      out.push({
        category: "LOGIC",
        kind: "sql_null_comparison",
        confidence: 0.8,
        label: "Comparaison avec NULL par « = » ou « != » : elle n'est jamais vraie en SQL. Il faut écrire IS NULL ou IS NOT NULL.",
        tests: [],
      });
      break;
    }
  }
  return out;
}
