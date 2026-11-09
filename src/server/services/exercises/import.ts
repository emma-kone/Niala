import { z } from "zod";
import { db } from "@/lib/db";
import { ApiHttpError } from "@/lib/api-helpers";
import { runPool } from "@/lib/concurrency";
import { UNTRUSTED_RULES, quoteInText, wrapUntrusted } from "@/server/ai/guard";
import { AiCallError, AiQuotaError, AiUnavailableError, isAiConfigured } from "@/server/ai/provider";
import { generateStructured } from "@/server/ai/structured";
import { CORRECTION_MODES, EXERCISE_MODES, POINT_STEP, QUESTION_TYPES, TYPE_LABEL } from "@/server/domain/exercise-types";
import { allocatePoints, buildQuestion, upgradeToWorkspace, maxQuestions, rawQuestionSchema, semanticProblem, type BuiltQuestion } from "@/server/domain/exercise-model";
import { loadVersionPages } from "@/server/services/analysis/analysis-service";
import { getStorage } from "@/server/storage";
import { languageName, purgeOccasionalExercises } from "./attempts";
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
- workspace : cas pratique de modélisation (Merise), de calcul ou d'algorithmique : "environment":"merise|math|algo","reference":"résolution modèle","criteria":["critère 1","critère 2"],"deliverables":["MCD","MLD"]
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

  const doc = await db.document.findFirst({ where: { id: config.documentId, userId }, include: { currentVersion: true } });
  if (!doc) throw new ApiHttpError("Document introuvable.", 404);
  const version = doc.currentVersion;
  if (!version) throw new ApiHttpError("Le contenu de ce document est indisponible.", 409);
  const settings = await db.userSettings.findUnique({ where: { userId }, select: { exerciseLang: true } });

  const pages = ["READY", "PARTIAL"].includes(version.extractStatus) ? await loadVersionPages(userId, version.id) : [];
  const fullText = pages.map((p) => p.text).join("\n");
  const compact = fullText.replace(/\s/g, "").length;
  const scanned = doc.type === "pdf" && (compact < MIN_TEXT_CHARS || version.extractStatus === "PARTIAL");
  if (compact < MIN_TEXT_CHARS && !scanned) throw new ApiHttpError("Ce document ne contient pas assez de texte lisible pour y retrouver des exercices.", 409);

  let attachment: { mime: string; data: string } | undefined;
  if (scanned) {
    if (!version.storageKey) throw new ApiHttpError("Le fichier d'origine est indisponible.", 409);
    const file = await getStorage().read(version.storageKey);
    if (file.length > MAX_ATTACHMENT_BYTES) throw new ApiHttpError("Ce PDF scanné est trop volumineux pour être lu (15 Mo maximum).", 413);
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

  let failures = 0;
  let fatal = null as Error | null;
  const language = languageName(settings?.exerciseLang);
  const responses = await runPool(windows, 3, async (text, i) => {
    if (fatal) return null;
    const user = `Langue des textes ajoutés par toi (corrigés, explications) : ${language}. Conserve la langue du document pour les énoncés.\nPartie ${i + 1} sur ${windows.length} du document.\n${text.trim() ? wrapUntrusted("document", text) : "Le document est joint à ce message : lis-le directement."}`;
    try {
      return (await generateStructured({ userId, op: "exercise.import", promptVersion: IMPORT_PROMPT_VERSION, system: SYSTEM, user, schema: responseSchema, maxTokens: 16_000, temperature: 0.1, timeoutMs: 180_000, attachment })).data;
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
  for (const response of responses) {
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
        if (!attachment && !quoteInText(p.data.source.quote, fullText)) {
          ungrounded++;
          continue;
        }
        const meta = questionMeta.parse(rawQ);
        const built = upgradeToWorkspace(buildQuestion(p.data));
        Object.assign(built.payload, { rich: true, label: meta.label ?? null, group: { index: group, title: exercise.title ?? `Exercice ${group}`, instructions: exercise.instructions ?? null, context: exercise.context ?? null } });
        const page = pages.find((pg) => quoteInText(p.data.source.quote, pg.text))?.page ?? null;
        accepted.push({
          slot: { slot: slotNumber, type: p.data.type, difficulty: "moyenne" },
          built,
          explanation: p.data.explanation ?? null,
          refs: [{ quote: p.data.source.quote, page, documentId: doc.id, documentName: doc.name, subjectId: doc.subjectId }],
          concepts: p.data.concepts,
          weight: meta.points ?? 1,
          fromDocument: meta.fromDocument,
        });
      }
    }
  }

  if (accepted.length === 0) {
    if (fatal) throw new ApiHttpError(fatal instanceof AiQuotaError ? fatal.message : "Le service d'IA n'est pas configuré.", fatal instanceof AiQuotaError ? 429 : 503);
    if (failures === windows.length) throw new ApiHttpError("Le service d'IA est momentanément indisponible. Réessayez dans un instant.", 502);
    throw new ApiHttpError("Aucun exercice exploitable n'a été trouvé dans ce document. Pour créer des exercices à partir d'un cours, choisissez « Depuis un cours ».", 422);
  }

  const unverified = await verifyPractical(accepted);
  const total = Math.max(config.totalPoints, accepted.length * POINT_STEP);
  const points = allocatePoints(total, accepted.map((a) => a.weight));

  const proposed = accepted.filter((a) => !a.fromDocument).length;
  const notes: string[] = [];
  if (attachment) notes.push("Ce document est en partie scanné : relisez les énoncés, leur fidélité n'a pas pu être contrôlée automatiquement.");
  if (proposed) notes.push(`Le corrigé de ${proposed} question(s) ne figure pas dans le document : il a été proposé par l'IA, à vérifier en cas de doute.`);
  if (invalid + ungrounded) notes.push(`${invalid + ungrounded} question(s) n'ont pas pu être reproduites de façon fiable et ont été écartées.`);
  if (failures) notes.push(`${failures} partie(s) du document n'ont pas pu être lues.`);
  if (accepted.length >= limit) notes.push(`Seules les ${limit} premières questions ont été reprises.`);
  if (unverified) notes.push(`${unverified} question(s) de programmation ou SQL seront corrigées par lecture, sans tests.`);
  const notice = notes.join(" ") || null;

  const id = await saveExercise(userId, {
    subjectId: doc.subjectId,
    documentId: doc.id,
    versionId: version.id,
    origin: "IMPORTED",
    saved: config.saved,
    title: config.title?.trim() || doc.name.slice(0, 160),
    totalPoints: total,
    config: { ...config, totalPoints: total, documentIds: [doc.id], sources: [{ id: doc.id, name: doc.name }], types: [...new Set(accepted.map((a) => a.built.type))], questionCount: accepted.length, difficulty: null, coverage: { mode: "all" }, generated: accepted.length, exercisesFound: group, notice, promptVersion: IMPORT_PROMPT_VERSION },
    accepted,
    points,
  });
  void TYPE_LABEL;
  return { id, subjectId: doc.subjectId, created: accepted.length, exercises: group, notice };
}
