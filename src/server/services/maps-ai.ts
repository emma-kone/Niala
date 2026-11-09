import { randomBytes } from "node:crypto";
import { z } from "zod";
import { db } from "@/lib/db";
import { ApiHttpError } from "@/lib/api-helpers";
import { UNTRUSTED_RULES, wrapUntrusted } from "@/server/ai/guard";
import { AiCallError, AiQuotaError, AiUnavailableError, isAiConfigured } from "@/server/ai/provider";
import { generateStructured } from "@/server/ai/structured";
import { layoutTree } from "@/server/domain/map-layout";
import { buildMindMap, rawMindMapSchema } from "@/server/domain/mindmap-build";
import { loadVersionPages, pagesBetween } from "@/server/services/analysis/analysis-service";
import { languageName } from "@/server/services/exercises/attempts";
import { requireSubject } from "@/server/services/folders";
import { persistMindMap } from "./maps";

// ─────────────────────────────────────────────────────────────────────────────
// Génération d'une carte mentale par l'IA, directement depuis un cours (ou un texte fourni), sans analyse préalable.
// L'IA propose une hiérarchie et des liens ; le serveur la contrôle (arbre cohérent, provenance vérifiée dans le texte)
// avant d'en faire une carte éditable.
// ─────────────────────────────────────────────────────────────────────────────

export const MINDMAP_PROMPT_VERSION = "mindmap-v1";
const MAX_CHARS = 48_000;
const MIN_CHARS = 300;

export const mindMapRequestSchema = z
  .object({
    documentId: z.string().min(1).max(64).optional(),
    text: z.string().max(200_000).optional(),
    title: z.string().trim().max(160).optional(),
    pageFrom: z.number().int().min(1).optional(),
    pageTo: z.number().int().min(1).optional(),
    subjectId: z.string().min(1).max(64).nullable().optional(),
  })
  .refine((r) => r.documentId || r.text?.trim(), { message: "Indiquez un cours ou collez un texte à cartographier." })
  .refine((r) => !r.pageFrom || !r.pageTo || r.pageTo >= r.pageFrom, { message: "La page de fin précède la page de début." });

const SYSTEM = `Tu transformes un cours en carte mentale hiérarchique, fidèle à son contenu et à sa logique.
${UNTRUSTED_RULES}
Règles :
1. Comprends d'abord le cours : thème principal, grandes parties, notions importantes, définitions, formules, méthodes et exemples. Ne fais PAS une branche par paragraphe : regroupe, hiérarchise, synthétise.
2. "nodes" : un arbre. Un SEUL nœud racine (parent null) = le thème principal. 4 à 8 branches principales (parties ou chapitres du cours), puis des sous-branches (notions), au plus 5 niveaux. 20 à 70 nœuds selon la richesse du cours.
3. Chaque "label" est court (80 caractères au plus, mots-clés plutôt que phrases). "detail" (500 au plus) : la définition, la formule ou la règle telle qu'elle figure dans le cours. "kind" : theme | chapter | concept | definition | formula | method | example. "page" : la page du cours si elle est indiquée par les repères [Page n].
4. "links" : au plus 20 relations TRANSVERSALES entre nœuds de branches différentes (PREREQUISITE : A est nécessaire pour B ; EXAMPLE_OF ; CONTRASTS ; DEFINES ; RELATED), avec un "label" court facultatif. Ne duplique pas les liens parent-enfant.
5. N'invente aucune notion absente du cours.
Réponse : {"title":"...","nodes":[{"id":"n1","label":"...","parent":null,"kind":"theme","detail":"...","page":1}],"links":[{"from":"n3","to":"n7","type":"PREREQUISITE","label":"..."}]}`;

const newId = (prefix: string) => prefix + randomBytes(10).toString("hex");

export async function generateMindMapFromContent(userId: string, rawInput: unknown) {
  const parsed = mindMapRequestSchema.safeParse(rawInput);
  if (!parsed.success) throw new ApiHttpError(parsed.error.issues[0]?.message ?? "Demande invalide.", 422);
  const input = parsed.data;
  if (!isAiConfigured()) throw new ApiHttpError("La génération de cartes mentales nécessite le service d'IA, qui n'est pas configuré (GEMINI_API_KEY).", 503);

  let text = "";
  let docName: string | null = null;
  let subjectId: string | null = input.subjectId ?? null;
  let documentId: string | null = null;
  let truncated = false;
  if (input.documentId) {
    const doc = await db.document.findFirst({ where: { id: input.documentId, userId }, include: { currentVersion: true } });
    if (!doc) throw new ApiHttpError("Cours introuvable.", 404);
    const version = doc.currentVersion;
    if (!version || !["READY", "PARTIAL"].includes(version.extractStatus)) throw new ApiHttpError("Le texte de ce cours n'a pas pu être extrait : impossible de créer une carte.", 409);
    const pages = pagesBetween(await loadVersionPages(userId, version.id), input.pageFrom ?? null, input.pageTo ?? null);
    text = pages.map((p) => `${p.page ? `\n[Page ${p.page}]\n` : "\n"}${p.text}`).join("");
    docName = doc.name;
    documentId = doc.id;
    subjectId = doc.subjectId;
  } else {
    text = input.text!.trim();
    if (subjectId) await requireSubject(userId, subjectId);
  }
  if (text.replace(/\s/g, "").length < MIN_CHARS) throw new ApiHttpError("Le contenu est trop court pour en tirer une carte mentale (300 caractères au moins).", 422);
  if (text.length > MAX_CHARS) {
    text = text.slice(0, MAX_CHARS);
    truncated = true;
  }

  const settings = await db.userSettings.findUnique({ where: { userId }, select: { exerciseLang: true } });
  const user = `Langue des libellés : ${languageName(settings?.exerciseLang)}.\n${docName ? `Cours : ${docName}.\n` : ""}${wrapUntrusted("cours", text)}`;
  let raw;
  try {
    raw = (await generateStructured({ userId, op: "mindmap.generate", promptVersion: MINDMAP_PROMPT_VERSION, system: SYSTEM, user, schema: rawMindMapSchema, maxTokens: 12_000, temperature: 0.2, timeoutMs: 150_000 })).data;
  } catch (e) {
    if (e instanceof AiQuotaError) throw new ApiHttpError(e.message, 429);
    if (e instanceof AiUnavailableError) throw new ApiHttpError("Le service d'IA n'est pas configuré.", 503);
    if (e instanceof AiCallError) throw new ApiHttpError(e.message, 502);
    throw e;
  }

  const built = buildMindMap(raw, text, input.title || docName || "Carte mentale");
  const idOf = new Map(built.nodes.map((n) => [n.key, newId("n")]));
  const nodes = built.nodes.map((n) => ({
    id: idOf.get(n.key)!,
    label: n.label,
    x: 0,
    y: 0,
    origin: n.origin,
    conceptId: null,
    sectionId: null,
    data: n.detail || n.page ? { ...(n.page ? { page: n.page } : {}), ...(n.detail ? { definition: n.detail.slice(0, 600) } : {}) } : null,
  }));
  const edges = [
    ...built.nodes.filter((n) => n.parent).map((n) => ({ id: newId("e"), source: idOf.get(n.key)!, target: idOf.get(n.parent!)!, type: "PART_OF" as const, label: null, origin: n.origin })),
    ...built.links.map((l) => ({ id: newId("e"), source: idOf.get(l.from)!, target: idOf.get(l.to)!, type: l.type, label: l.label ?? null, origin: "AI_INFERRED" as const })),
  ];
  const pos = layoutTree(nodes, edges);
  for (const n of nodes) Object.assign(n, pos[n.id]);

  const title = (input.title || `Carte mentale — ${docName ?? built.title}`).slice(0, 160);
  const { id } = await persistMindMap(userId, { subjectId, documentId, analysisId: null, kind: "STRUCTURE", title, nodes, edges });
  return { id, subjectId, nodes: nodes.length, links: built.links.length, truncated, notice: truncated ? "Le texte était long : seule sa première partie (environ 48 000 caractères) a été cartographiée. Générez d'autres cartes par plages de pages pour le reste." : null };
}
