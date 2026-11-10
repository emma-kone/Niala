import { z } from "zod";
import { db } from "@/lib/db";
import { ApiHttpError } from "@/lib/api-helpers";
import { runPool } from "@/lib/concurrency";
import { UNTRUSTED_RULES, quoteInText, wrapUntrusted } from "@/server/ai/guard";
import { AiCallError, AiQuotaError, AiUnavailableError, isAiConfigured } from "@/server/ai/provider";
import { generateStructured } from "@/server/ai/structured";
import { CORRECTION_MODES, EXERCISE_MODES, MAX_SOURCE_DOCUMENTS, POINT_STEP, QUESTION_TYPES, TYPE_LABEL } from "@/server/domain/exercise-types";
import { allocatePoints, buildQuestion, maxQuestions, rawQuestionSchema, semanticProblem, type BuiltQuestion } from "@/server/domain/exercise-model";
import { loadVersionPages } from "@/server/services/analysis/analysis-service";
import { getStorage } from "@/server/storage";
import { purgeOccasionalExercises } from "./attempts";
import { detectLanguage, languageLabel } from "@/server/domain/language";
import { saveExercise, verifyPractical } from "./generation";

// ─────────────────────────────────────────────────────────────────────────────
// Reproduction d'un sujet existant : le document est lu, ses exercices, consignes, questions et sous-questions sont
// identifiés puis structurés pour être résolus dans Niala. L'énoncé vient du document : chaque question doit citer un
// passage réel du texte extrait. Un PDF scanné est lu directement par le modèle ; la vérification des citations n'est
// alors pas possible et l'étudiant en est averti. Le corrigé est repris du document s'il y figure, sinon proposé par l'IA.
// ─────────────────────────────────────────────────────────────────────────────

export const IMPORT_PROMPT_VERSION = "exercise-import-v1";
const WINDOW_CHARS = 30_000;
const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024;
const MIN_TEXT_CHARS = 200;

export const importConfigSchema = z.object({
  documentId: z.string().min(1).max(64),
  /** Plusieurs sujets à reproduire dans un seul exercice (le document principal est toujours inclus). */
  documentIds: z.array(z.string().min(1).max(64)).max(MAX_SOURCE_DOCUMENTS).optional(),
  title: z.string().trim().max(160).optional(),
  totalPoints: z.number().finite().min(POINT_STEP).max(100).default(20),
  correctionMode: z.enum(CORRECTION_MODES).default("final"),
  mode: z.enum(EXERCISE_MODES).default("personnalise"),
  saved: z.boolean().default(true),
});

const FORMATS = `- qcm_single : "options":[…3 à 5…],"correctIndex":0
- qcm_multiple : "options":[…4 à 6…],"correctIndexes":[0,2]
- true_false : "answer":true
- fill_blank : statement avec "___" pour chaque trou, "blanks":[{"accepted":["réponse"]}]
- short_answer : "accepted":["réponse","variante"]
- open : "reference":"réponse modèle","criteria":["critère 1","critère 2"]
- practical : "reference":"résolution modèle (calcul, démonstration, étapes)","criteria":["critère 1","critère 2"]
- code : "language":"python|javascript|typescript","starterCode":"","referenceSolution":"…","criteria":["…","…"],"tests":[]
- sql : "setupSql":"CREATE TABLE … ; INSERT …","referenceSql":"SELECT …","criteria":["…","…"],"ordered":false,"checks":[],"variants":[]`;

const SYSTEM = `Tu reproduis fidèlement les exercices d'un document (TD, devoir, sujet d'examen) pour qu'un étudiant les résolve dans une application interactive.
${UNTRUSTED_RULES}
Règles :
1. Identifie chaque exercice, sa consigne générale, ses données (énoncé commun, tableaux, formules), puis chaque question et sous-question, dans l'ordre du document.
2. N'invente aucune question et n'en omets aucune. Reprends le texte du document sans le reformuler, sauf le minimum pour qu'une sous-question se comprenne seule. Si le document ne contient aucun exercice, réponds {"found":false,"exercises":[]}.
3. "instructions" : consigne générale de l'exercice. "context" : données communes en Markdown ; tableaux en Markdown, formules en LaTeX entre $…$.
4. Chaque question : "label" (numérotation d'origine, ex. « 1.a »), "statement" (900 caractères au plus ; les données longues vont dans "context"), "source":{"quote":"<passage recopié VERBATIM du document, 15 à 300 caractères>"}, "type", "points" (barème du document s'il est indiqué, sinon omis), "explanation" (pourquoi la réponse est correcte), "concepts":[…1 à 3 notions…].
5. Choisis le type qui correspond à la forme d'origine. Une question rédigée, un calcul ou une démonstration est "open" ou "practical".
6. Corrigé : si le document le contient, reprends-le et mets "fromDocument":true. Sinon résous la question toi-même avec rigueur et mets "fromDocument":false. Si tu ne peux pas la résoudre avec certitude (figure illisible, données manquantes), ajoute-la quand même en type "open" avec une référence décrivant la démarche attendue.
Format de réponse : {"found":true,"exercises":[{"title":"…","instructions":"…","context":"…","questions":[{"label":"…","type":"…","statement":"…","source":{"quote":"…"},"fromDocument":false,"explanation":"…","concepts":["…"], …champs du type}]}]}
Champs par type :
${FORMATS}`;

const questionMeta = z.object({ label: z.string().trim().max(24).optional().catch(undefined), points: z.number().positive().max(100).optional().catch(undefined), fromDocument: z.boolean().catch(false) });
const exerciseSchema = z.object({ title: z.string().trim().max(200).optional().catch(undefined), instructions: z.string().trim().max(4000).optional().catch(undefined), context: z.string().trim().max(12000).optional().catch(undefined), questions: z.array(z.unknown()).max(60) });
const responseSchema = z.object({ found: z.boolean().catch(true), exercises: z.array(exerciseSchema).max(30) });

interface Parsed {
  slot: { slot: number; type: (typeof QUESTION_TYPES)[number]; difficulty: "moyenne" };
  built: BuiltQuestion;
  explanation: string | null;
  refs: { quote: string; page: number | null; documentId: string; documentName: string; subjectId: string | null }[];
  concepts: string[];
  weight: number;
  fromDocument: boolean;
}

export async function importExercises(userId: string, raw: unknown) {
  const parsed = importConfigSchema.safeParse(raw);
  if (!parsed.success) throw new ApiHttpError(parsed.error.issues[0]?.message ?? "Configuration invalide.", 422);
  const config = parsed.data;
  if (!isAiConfigured()) throw new ApiHttpError("L'import d'exercices nécessite le service d'IA, qui n'est pas configuré (GEMINI_API_KEY).", 503);
  await purgeOccasionalExercises(userId);

  const documentIds = [...new Set([config.documentId, ...(config.documentIds ?? [])])];
  const found = await db.document.findMany({ where: { id: { in: documentIds }, userId }, include: { currentVersion: true } });
  if (found.length !== documentIds.length) throw new ApiHttpError("Document introuvable.", 404);
  const several = documentIds.length > 1;

  // Chaque document est lu séparément (texte, ou PDF scanné lu directement par le modèle), puis les exercices sont réunis dans l'ordre des documents.
  const sources = await Promise.all(
    documentIds.map(async (id) => {
      const doc = found.find((d) => d.id === id)!;
      const version = doc.currentVersion;
      const label = several ? `« ${doc.name} »` : "ce document";
      if (!version) throw new ApiHttpError(`Le contenu de ${label} est indisponible.`, 409);
      const pages = ["READY", "PARTIAL"].includes(version.extractStatus) ? await loadVersionPages(userId, version.id) : [];
      const fullText = pages.map((p) => p.text).join("\n");
      const compact = fullText.replace(/\s/g, "").length;
      const scanned = doc.type === "pdf" && (compact < MIN_TEXT_CHARS || version.extractStatus === "PARTIAL");
      if (compact < MIN_TEXT_CHARS && !scanned) throw new ApiHttpError(`${several ? label : "Ce document"} ne contient pas assez de texte lisible pour y retrouver des exercices.`, 409);

      let attachment: { mime: string; data: string } | undefined;
      if (scanned) {
        if (!version.storageKey) throw new ApiHttpError("Le fichier d'origine est indisponible.", 409);
        const file = await getStorage().read(version.storageKey);
        if (file.length > MAX_ATTACHMENT_BYTES) throw new ApiHttpError(`${several ? label : "Ce PDF scanné"} est trop volumineux pour être lu (15 Mo maximum).`, 413);
        attachment = { mime: "application/pdf", data: file.toString("base64") };
      }

      // Les longs documents sont découpés par pages ; l'ordre d'origine est rétabli après les appels parallèles.
      const windows: string[] = [];
      if (attachment) windows.push(fullText.slice(0, WINDOW_CHARS));
      else {
        let current = "";
        for (const p of pages) {
          if (current && current.length + p.text.length > WINDOW_CHARS) {
            windows.push(current);
            current = "";
          }
          current += `${p.page ? `\n[Page ${p.page}]\n` : "\n"}${p.text}`;
        }
        if (current.trim()) windows.push(current);
      }
      return { doc, version, pages, fullText, attachment, windows };
    })
  );

  // Corrigés et explications ajoutés dans la langue du document (un PDF scanné sans texte reste en français).
  const contentLang = detectLanguage(sources.map((s) => s.fullText).join("\n").slice(0, 60_000));
  const language = languageLabel(contentLang);
  const jobs = sources.flatMap((source) => source.windows.map((text, i) => ({ source, text, i })));
  let failures = 0;
  let fatal = null as Error | null;
  const responses = await runPool(jobs, 3, async ({ source, text, i }) => {
    if (fatal) return null;
    const user = `Langue des textes ajoutés par toi (corrigés, explications) : ${language}. Conserve la langue du document pour les énoncés.\nPartie ${i + 1} sur ${source.windows.length} du document.\n${text.trim() ? wrapUntrusted("document", text) : "Le document est joint à ce message : lis-le directement."}`;
    try {
      return (await generateStructured({ userId, op: "exercise.import", promptVersion: IMPORT_PROMPT_VERSION, system: SYSTEM, user, schema: responseSchema, maxTokens: 16_000, temperature: 0.1, timeoutMs: 180_000, attachment: source.attachment })).data;
    } catch (e) {
      failures++;
      if (e instanceof AiQuotaError || e instanceof AiUnavailableError) fatal = e;
      else if (!(e instanceof AiCallError)) console.error("[exercise.import]", e);
      return null;
    }
  });

  const accepted: Parsed[] = [];
  let invalid = 0;
  let ungrounded = 0;
  let group = 0;
  const limit = maxQuestions();
  jobs.forEach(({ source }, jobIndex) => {
    const response = responses[jobIndex];
    for (const exercise of response?.exercises ?? []) {
      group++;
      for (const rawQ of exercise.questions) {
        if (accepted.length >= limit) break;
        const slotNumber = accepted.length + 1;
        const p = rawQuestionSchema.safeParse({ ...(rawQ as object), slot: slotNumber, concepts: (rawQ as { concepts?: unknown }).concepts ?? [] });
        if (!p.success || semanticProblem(p.data)) {
          invalid++;
          continue;
        }
        // Texte disponible : l'énoncé doit provenir du document. Scan lu par le modèle : aucune vérification n'est possible.
        if (!source.attachment && !quoteInText(p.data.source.quote, source.fullText)) {
          ungrounded++;
          continue;
        }
        const meta = questionMeta.parse(rawQ);
        const built = buildQuestion(p.data);
        Object.assign(built.payload, { rich: true, label: meta.label ?? null, group: { index: group, title: exercise.title ?? `Exercice ${group}`, instructions: exercise.instructions ?? null, context: exercise.context ?? null } });
        const page = source.pages.find((pg) => quoteInText(p.data.source.quote, pg.text))?.page ?? null;
        accepted.push({
          slot: { slot: slotNumber, type: p.data.type, difficulty: "moyenne" },
          built,
          explanation: p.data.explanation ?? null,
          refs: [{ quote: p.data.source.quote, page, documentId: source.doc.id, documentName: source.doc.name, subjectId: source.doc.subjectId }],
          concepts: p.data.concepts,
          weight: meta.points ?? 1,
          fromDocument: meta.fromDocument,
        });
      }
    }
  });

  if (accepted.length === 0) {
    if (fatal) throw new ApiHttpError(fatal instanceof AiQuotaError ? fatal.message : "Le service d'IA n'est pas configuré.", fatal instanceof AiQuotaError ? 429 : 503);
    if (failures === jobs.length) throw new ApiHttpError("Le service d'IA est momentanément indisponible. Réessayez dans un instant.", 502);
    throw new ApiHttpError(`Aucun exercice exploitable n'a été trouvé dans ${several ? "ces documents" : "ce document"}. Pour créer de nouvelles questions à partir d'un cours, choisissez « Créer de nouvelles questions ».`, 422);
  }

  const unverified = await verifyPractical(accepted);
  const total = Math.max(config.totalPoints, accepted.length * POINT_STEP);
  const points = allocatePoints(total, accepted.map((a) => a.weight));

  const proposed = accepted.filter((a) => !a.fromDocument).length;
  const notes: string[] = [];
  if (sources.some((s) => s.attachment)) notes.push(`${several ? "Un ou plusieurs documents sont" : "Ce document est"} en partie scanné${several ? "s" : ""} : relisez les énoncés, leur fidélité n'a pas pu être contrôlée automatiquement.`);
  if (proposed) notes.push(`Le corrigé de ${proposed} question(s) ne figure pas dans le document : il a été proposé par l'IA, à vérifier en cas de doute.`);
  if (invalid + ungrounded) notes.push(`${invalid + ungrounded} question(s) n'ont pas pu être reproduites de façon fiable et ont été écartées.`);
  if (failures) notes.push(`${failures} partie(s) du document n'ont pas pu être lues.`);
  if (accepted.length >= limit) notes.push(`Seules les ${limit} premières questions ont été reprises.`);
  if (unverified) notes.push(`${unverified} question(s) de programmation ou SQL seront corrigées par lecture, sans tests.`);
  const notice = notes.join(" ") || null;

  const { doc, version } = sources[0];
  const id = await saveExercise(userId, {
    subjectId: doc.subjectId,
    documentId: doc.id,
    versionId: version.id,
    origin: "IMPORTED",
    saved: config.saved,
    title: config.title?.trim() || (several ? `${doc.name.slice(0, 120)} et ${documentIds.length - 1} autre${documentIds.length > 2 ? "s" : ""}` : doc.name).slice(0, 160),
    totalPoints: total,
    config: { ...config, totalPoints: total, documentIds, sources: sources.map((s) => ({ id: s.doc.id, name: s.doc.name })), types: [...new Set(accepted.map((a) => a.built.type))], questionCount: accepted.length, difficulty: null, coverage: { mode: "all" }, generated: accepted.length, exercisesFound: group, notice, promptVersion: IMPORT_PROMPT_VERSION },
    accepted,
    points,
    language: contentLang,
  });
  void TYPE_LABEL;
  return { id, subjectId: doc.subjectId, created: accepted.length, exercises: group, notice };
}
