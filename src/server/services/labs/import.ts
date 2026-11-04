import { z } from "zod";
import { ApiHttpError } from "@/lib/api-helpers";
import { db } from "@/lib/db";
import { generateStructured } from "@/server/ai/structured";
import { UNTRUSTED_RULES, quoteInText, wrapUntrusted } from "@/server/ai/guard";
import { AiCallError, AiQuotaError, AiUnavailableError, isAiConfigured } from "@/server/ai/provider";
import { languageOf, parseCodeTests, sqlSpecSchema, type CodeTest, type SqlSpec } from "@/server/domain/lab-tests";
import { loadVersionPages } from "@/server/services/analysis/analysis-service";
import { verifyCodeReference, verifySqlSpec } from "./execute";

// ─────────────────────────────────────────────────────────────────────────────
// Import d'un document d'énoncés (TP, sujet d'examen) → exercices de laboratoire.
//  - L'énoncé vient du document (citation vérifiée dans le texte réel) ; l'IA ne l'invente pas.
//  - Les tests et la solution de référence sont écrits par l'IA, mais un test n'est retenu que si la
//    solution de référence l'a RÉUSSI à l'exécution isolée : la correction reste objective.
//  - Un énoncé dont les tests ne peuvent pas être validés est conservé sans tests (exécution libre, indices).
// ─────────────────────────────────────────────────────────────────────────────

export const IMPORT_PROMPT_VERSION = "lab-import-v1";
const MAX_CHARS = 24_000;
const text = (max: number, min = 1) => z.string().trim().min(min).max(max);
const source = z.object({ quote: text(400, 15) });

const rawCode = z.object({
  title: text(120),
  statement: text(3000, 20),
  source,
  language: text(20),
  starterCode: z.string().max(3000).optional(),
  referenceSolution: text(4000, 3),
  tests: z.array(z.unknown()).max(10),
});
const rawSql = z.object({
  title: text(120),
  statement: text(3000, 20),
  source,
  setupSql: z.string().max(6000).optional(),
  referenceSql: text(3000, 6),
  starterSql: z.string().max(1000).optional(),
  checks: z.array(text(1000)).max(3).optional(),
  ordered: z.boolean().optional(),
  variants: z.array(z.object({ name: text(80), extraSql: text(2000) })).max(4).optional(),
});
const response = z.object({ exercises: z.array(z.unknown()).max(6), found: z.boolean().catch(true) });

const SYSTEM_COMMON = `Tu extrais d'un document des exercices pratiques (énoncés) pour un laboratoire d'entraînement.
${UNTRUSTED_RULES}
Règles :
1. N'extrais QUE des exercices réellement présents dans le document. Si le document ne contient aucun énoncé pratique, réponds {"exercises":[],"found":false}.
2. "statement" reprend fidèlement la consigne du document (reformulation minimale pour qu'elle soit autonome). "source.quote" : un passage RECOPIÉ VERBATIM du document (15 à 300 caractères) tiré de cet énoncé.
3. Maximum 5 exercices ; choisis les plus clairs. Réponds en français.
4. Les tests doivent se déduire de l'énoncé ; si l'énoncé donne des exemples d'entrées/sorties, utilise-les en priorité. "expected" doit être EXACTEMENT ce que produit ta solution de référence.`;

const CODE_FORMAT = `Réponse : {"found":true,"exercises":[{"title":"...","statement":"...","source":{"quote":"..."},"language":"python|javascript|typescript","starterCode":"squelette éventuel","referenceSolution":"solution complète qui DÉFINIT la fonction appelée par les tests","tests":[{"name":"cas simple","call":{"fn":"nom","args":[1,2]},"expected":3},{"name":"cas limite : vide","call":{"fn":"nom","args":[[]]},"expected":0,"edge":true}]}]}
Alternative de test sans fonction (programme avec entrée/sortie) : {"name":"...","stdin":"entrée\\n","expected":"sortie exacte\\n"}. 3 à 6 tests dont au moins un cas limite. Si l'énoncé est dans un autre langage que python/javascript/typescript, choisis python et signale-le dans le statement.`;
const SQL_FORMAT = `Réponse : {"found":true,"exercises":[{"title":"...","statement":"...","source":{"quote":"..."},"setupSql":"CREATE TABLE … ; INSERT … (au moins 5 lignes réalistes, cohérentes avec l'énoncé)","referenceSql":"SELECT …","starterSql":"-- votre requête ici","ordered":false,"checks":[],"variants":[{"name":"table vide","extraSql":"DELETE FROM … ;"}]}]}
SQLite. "ordered":true seulement si l'énoncé impose un tri. "checks" : SELECT de contrôle de l'état final, uniquement pour INSERT/UPDATE/DELETE/DDL. "variants" : 1 à 2 jeux de données limites ajoutés après setupSql. Si le document fournit déjà le schéma, reprends-le fidèlement.`;

export interface ImportedExercise {
  title: string;
  statement: string;
  quote: string;
  page: number | null;
  kind: "CODE" | "SQL";
  language: string;
  starter: string;
  reference: string;
  tests?: CodeTest[];
  sql?: SqlSpec;
  /** Tests validés par exécution de la solution de référence. */
  verified: boolean;
  droppedTests: number;
}

export interface ImportResult {
  document: { id: string; name: string; subjectId: string | null; versionId: string };
  exercises: ImportedExercise[];
  notice: string | null;
}

export async function extractLabExercises(userId: string, input: { documentId: string; kind: "CODE" | "SQL"; language?: string }): Promise<ImportResult> {
  if (!isAiConfigured()) throw new ApiHttpError("L'import d'énoncés nécessite le service d'IA, qui n'est pas configuré (GEMINI_API_KEY).", 503);
  const doc = await db.document.findFirst({ where: { id: input.documentId, userId }, include: { currentVersion: true } });
  if (!doc) throw new ApiHttpError("Document introuvable.", 404);
  const version = doc.currentVersion;
  if (!version || !["READY", "PARTIAL"].includes(version.extractStatus)) throw new ApiHttpError("Le texte de ce document n'a pas pu être extrait.", 409);
  const pages = await loadVersionPages(userId, version.id);
  let body = "";
  let lastPage: number | null = null;
  let cut = false;
  for (const p of pages) {
    const chunk = `\n[page ${p.page ?? "?"}]\n${p.text}`;
    if (body.length + chunk.length > MAX_CHARS) {
      cut = true;
      break;
    }
    body += chunk;
    lastPage = p.page;
  }
  if (body.replace(/\s/g, "").length < 80) throw new ApiHttpError("Ce document contient trop peu de texte.", 409);

  const wantLang = input.kind === "CODE" ? (input.language ? languageOf(input.language) : null) : "sql";
  const system = `${SYSTEM_COMMON}\n${input.kind === "CODE" ? CODE_FORMAT : SQL_FORMAT}`;
  const user = `Type d'exercices recherchés : ${input.kind === "CODE" ? `programmation${wantLang && wantLang !== "sql" ? ` (langage ${wantLang})` : ""}` : "requêtes SQL"}.\n\nDocument :\n${wrapUntrusted("document", body)}`;

  let data: z.infer<typeof response>;
  try {
    data = (await generateStructured({ userId, op: "lab.import", promptVersion: IMPORT_PROMPT_VERSION, system, user, schema: response, maxTokens: 7000, temperature: 0.2, timeoutMs: 150_000 })).data;
  } catch (e) {
    if (e instanceof AiQuotaError) throw new ApiHttpError(e.message, 429);
    if (e instanceof AiUnavailableError) throw new ApiHttpError("Le service d'IA n'est pas configuré.", 503);
    if (e instanceof AiCallError) throw new ApiHttpError(e.message, 502);
    throw e;
  }

  const out: ImportedExercise[] = [];
  let rejected = 0;
  const pageOf = (quote: string) => pages.find((p) => quoteInText(quote, p.text))?.page ?? null;
  for (const raw of data.exercises) {
    if (input.kind === "CODE") {
      const p = rawCode.safeParse(raw);
      if (!p.success) { rejected++; continue; }
      const q = p.data;
      const lang = languageOf(q.language);
      if (!quoteInText(q.source.quote, body)) { rejected++; continue; }
      const candidates = parseCodeTests(q.tests);
      const chosen = wantLang && wantLang !== "sql" ? wantLang : lang && lang !== "sql" ? lang : "python";
      const v = await verifyCodeReference(chosen, q.referenceSolution, candidates).catch(() => null);
      const verified = !!v && v.tests.length >= 2;
      out.push({ title: q.title, statement: q.statement, quote: q.source.quote, page: pageOf(q.source.quote), kind: "CODE", language: chosen, starter: q.starterCode ?? "", reference: q.referenceSolution, tests: verified ? v!.tests : [], verified, droppedTests: v ? v.dropped : candidates.length });
    } else {
      const p = rawSql.safeParse(raw);
      if (!p.success) { rejected++; continue; }
      const q = p.data;
      if (!quoteInText(q.source.quote, body)) { rejected++; continue; }
      const spec = sqlSpecSchema.safeParse({ setupSql: q.setupSql ?? "", referenceSql: q.referenceSql, checks: q.checks ?? [], ordered: q.ordered ?? false, variants: q.variants ?? [] });
      if (!spec.success) { rejected++; continue; }
      const v = await verifySqlSpec(spec.data).catch(() => null);
      const ok = !!v?.baseOk;
      out.push({ title: q.title, statement: q.statement, quote: q.source.quote, page: pageOf(q.source.quote), kind: "SQL", language: "sql", starter: q.starterSql ?? "", reference: q.referenceSql, sql: ok ? v!.spec : spec.data, verified: ok, droppedTests: v?.dropped ?? 0 });
    }
  }

  const notes: string[] = [];
  if (!data.found || data.exercises.length === 0) notes.push("Aucun énoncé pratique n'a été trouvé dans ce document.");
  if (cut) notes.push(`Seules les pages jusqu'à la page ${lastPage ?? "?"} ont été lues (le document est long).`);
  if (rejected) notes.push(`${rejected} énoncé(s) proposé(s) ont été écartés (format invalide ou citation introuvable dans le document).`);
  const unverified = out.filter((e) => !e.verified).length;
  if (unverified) notes.push(`${unverified} exercice(s) sans tests automatiques fiables (la solution de référence n'a pas pu valider les tests) : exécution libre et indices seulement.`);
  const dropped = out.reduce((s, e) => s + e.droppedTests, 0);
  if (dropped) notes.push(`${dropped} test(s) incohérents avec la solution de référence ont été écartés.`);

  return { document: { id: doc.id, name: doc.name, subjectId: doc.subjectId, versionId: version.id }, exercises: out, notice: notes.join(" ") || null };
}
