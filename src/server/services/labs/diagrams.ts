import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { ApiHttpError } from "@/lib/api-helpers";
import { assertFound } from "@/lib/ownership";
import { UNTRUSTED_RULES, wrapUntrusted } from "@/server/ai/guard";
import { AiCallError, AiQuotaError, getProvider, type ChatTurn } from "@/server/ai/provider";
import { checkQuota } from "@/server/ai/structured";
import { RELIABILITY_RULES } from "@/server/reliability/claims";
import { track } from "@/server/analytics/track";
import { markActivity } from "@/server/services/progress/streak";
import { DIAGRAM_KINDS, PROPOSAL_FENCE, extractProposal, MCD_CARDINALITIES, UML_MULTIPLICITIES, describeDiagram, diagramSchema, diagramWarnings, mcdToMld, mldText, parseDiagram, sanitizeDiagram, starterDiagram, type Diagram, type DiagramKind } from "@/server/domain/diagram";

// ─────────────────────────────────────────────────────────────────────────────
// Laboratoire « Diagrammes » : MCD (Merise) et diagrammes de classes UML.
// Un espace de travail de type DIAGRAM garde le diagramme (JSON validé) dans son unique fichier, et le sujet
// de l'exercice (texte collé ou extrait d'un PDF) dans son énoncé. L'assistant IA voit le diagramme affiché,
// la sélection de l'étudiant et le sujet ; il peut proposer un diagramme modifié, que l'étudiant applique ou non.
// ─────────────────────────────────────────────────────────────────────────────

export const MAX_DIAGRAM_JSON = 400_000;
export const MAX_STATEMENT = 30_000;
const MAX_PDF_BYTES = 15 * 1024 * 1024;

interface DiagramBrief {
  origin: "manual" | "document";
  statement: string;
  verified: false;
  source?: { documentName?: string; documents?: string[]; pages?: number };
}

const text = (max: number, min = 1) => z.string().trim().min(min).max(max);

const createSchema = z.object({
  diagramKind: z.enum(["mcd", "uml"]).default("mcd"),
  title: text(120).optional(),
  subjectId: z.string().optional(),
  statement: z.string().max(MAX_STATEMENT).optional(),
  /** Partir d'un exemple de notation plutôt que d'une page vierge. */
  example: z.boolean().default(false),
});

const fileOf = (kind: DiagramKind, d: Diagram) => [{ name: kind === "mcd" ? "mcd.json" : "classes.json", language: kind, content: JSON.stringify(d) }];

export async function createDiagramWorkspace(userId: string, raw: unknown) {
  const p = createSchema.safeParse(raw ?? {});
  if (!p.success) throw new ApiHttpError(p.error.issues[0]?.message ?? "Demande invalide.", 422);
  const { diagramKind, subjectId } = p.data;
  if (subjectId) assertFound(await db.subject.findFirst({ where: { id: subjectId, userId }, select: { id: true } }), "Matière");
  const statement = p.data.statement?.trim();
  const diagram = p.data.example ? starterDiagram(diagramKind) : { kind: diagramKind, nodes: [], links: [] };
  const w = await db.labWorkspace.create({
    data: {
      userId,
      subjectId: subjectId ?? null,
      kind: "DIAGRAM",
      mode: statement ? "EXERCISE" : "FREE",
      title: p.data.title ?? (diagramKind === "mcd" ? "Nouveau MCD" : "Nouveau diagramme de classes"),
      files: fileOf(diagramKind, diagram) as unknown as Prisma.InputJsonValue,
      ...(statement ? { brief: { origin: "manual", statement, verified: false } satisfies DiagramBrief as unknown as Prisma.InputJsonValue } : {}),
    },
  });
  await db.learningActivity.create({ data: { userId, subjectId: w.subjectId, type: "LAB_DIAGRAM", refType: "lab", refId: w.id, title: w.title.slice(0, 160), status: "IN_PROGRESS" } });
  track(userId, "lab.create", { module: "diagram", sourceRef: w.id, props: { kind: "DIAGRAM", diagramKind } });
  return w;
}

const saveSchema = z.object({
  title: text(120).optional(),
  diagram: z.unknown().optional(),
  statement: z.string().max(MAX_STATEMENT).optional(),
});

/** Enregistrement automatique : diagramme (validé et nettoyé), titre, sujet. */
export async function saveDiagramWorkspace(userId: string, id: string, raw: unknown) {
  const w = assertFound(await db.labWorkspace.findFirst({ where: { id, userId, kind: "DIAGRAM" } }), "Espace de travail");
  const p = saveSchema.safeParse(raw ?? {});
  if (!p.success) throw new ApiHttpError(p.error.issues[0]?.message ?? "Demande invalide.", 422);
  const data: Prisma.LabWorkspaceUpdateInput = {};
  if (p.data.title) data.title = p.data.title;
  if (p.data.diagram !== undefined) {
    const parsed = diagramSchema.safeParse(p.data.diagram);
    if (!parsed.success) throw new ApiHttpError("Diagramme invalide : " + (parsed.error.issues[0]?.message ?? "format inattendu."), 422);
    const d = sanitizeDiagram(parsed.data);
    const json = JSON.stringify(d);
    if (json.length > MAX_DIAGRAM_JSON) throw new ApiHttpError("Diagramme trop volumineux.", 413);
    data.files = fileOf(d.kind, d) as unknown as Prisma.InputJsonValue;
    markActivity(userId);
  }
  if (p.data.statement !== undefined) {
    const statement = p.data.statement.trim();
    const prev = (w.brief as unknown as DiagramBrief | null) ?? null;
    data.brief = statement ? ({ origin: prev?.origin ?? "manual", statement, verified: false, ...(prev?.source ? { source: prev.source } : {}) } satisfies DiagramBrief as unknown as Prisma.InputJsonValue) : ({} as Prisma.InputJsonValue);
    data.mode = statement ? "EXERCISE" : "FREE";
  }
  return db.labWorkspace.update({ where: { id }, data });
}

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_SUBJECT_FILES = 10;

type SubjectFile = { name: string; bytes: Uint8Array };

/** Type réel du fichier, lu dans ses premiers octets (l'extension et le type annoncé ne suffisent pas). */
function sniff(bytes: Uint8Array): "pdf" | "image/png" | "image/jpeg" | "image/gif" | "image/webp" | null {
  const head = new TextDecoder("latin1").decode(bytes.slice(0, 12));
  if (head.startsWith("%PDF-")) return "pdf";
  if (bytes[0] === 0x89 && head.slice(1, 4) === "PNG") return "image/png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (head.startsWith("GIF8")) return "image/gif";
  if (head.startsWith("RIFF") && head.slice(8, 12) === "WEBP") return "image/webp";
  return null;
}

/** Texte d'une image ou d'un PDF scanné, transcrit par le modèle (Gemini lit les images et les PDF). */
async function transcribe(userId: string, file: SubjectFile, mime: string): Promise<string> {
  const provider = getProvider();
  if (!provider || provider.name !== "gemini") throw new ApiHttpError(`« ${file.name} » : la lecture des images et des PDF scannés nécessite le service d'IA Gemini. Collez le texte du sujet à la place.`, 503);
  try {
    await checkQuota(userId);
  } catch (e) {
    if (e instanceof AiQuotaError) throw new ApiHttpError(e.message, 429);
    throw e;
  }
  const started = Date.now();
  const system =
    "Tu transcris fidèlement le texte d'un sujet d'exercice (photo, capture ou document scanné). Recopie le texte tel quel, dans l'ordre de lecture, sans le résumer, le corriger ni le compléter. Reproduis les tableaux ligne par ligne, cellules séparées par « | ». Décris en une phrase entre crochets un schéma ou une figure s'il y en a. N'ajoute aucun commentaire. Si le document ne contient pas de texte lisible, réponds exactement : AUCUN_TEXTE.";
  const log = (model: string, respChars: number, ok: boolean, error?: string) =>
    db.aIUsageLog.create({ data: { userId, op: "lab.diagram.ocr@1", model, promptChars: system.length, respChars, ok, error: error?.slice(0, 500) ?? null, durationMs: Date.now() - started } }).catch(() => undefined);
  let text: string;
  try {
    const res = await provider.complete({ system, user: "Transcris le texte de ce document.", maxTokens: 8000, temperature: 0, attachment: { mime, data: Buffer.from(file.bytes).toString("base64") }, signal: AbortSignal.timeout(90_000) });
    await log(res.model, res.text.length, true);
    text = res.text.trim();
  } catch (e) {
    const message = e instanceof Error ? e.message : "Erreur inconnue";
    console.warn(`[lab.diagram.ocr] ${message}`);
    await log(provider.model, 0, false, message);
    throw new ApiHttpError(`Lecture de « ${file.name} » impossible pour le moment. Réessayez ou collez le texte du sujet.`, 502);
  }
  if (!text || text.includes("AUCUN_TEXTE")) throw new ApiHttpError(`« ${file.name} » ne contient pas de texte lisible. Essayez une image plus nette ou collez le texte.`, 422);
  return text;
}

/** Texte d'un fichier du sujet : PDF (texte extrait, ou transcrit s'il est scanné) ou image (transcrite). */
async function subjectText(userId: string, file: SubjectFile): Promise<{ text: string; pages: number }> {
  if (file.bytes.byteLength === 0) throw new ApiHttpError(`« ${file.name} » est vide.`, 422);
  const type = sniff(file.bytes);
  if (!type) throw new ApiHttpError(`« ${file.name} » n'est ni un PDF ni une image (PNG, JPEG, WebP, GIF).`, 422);
  if (type === "pdf") {
    if (file.bytes.byteLength > MAX_PDF_BYTES) throw new ApiHttpError(`« ${file.name} » est trop volumineux (15 Mo maximum par PDF).`, 413);
    let pages: string[];
    try {
      const { extractText, getDocumentProxy } = await import("unpdf");
      const pdf = await getDocumentProxy(new Uint8Array(file.bytes));
      pages = (await extractText(pdf, { mergePages: false })).text as unknown as string[];
    } catch {
      throw new ApiHttpError(`Lecture de « ${file.name} » impossible. Vérifiez le fichier ou collez le texte du sujet.`, 422);
    }
    const cleaned = pages.map((t) => t.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim());
    // PDF scanné (sans couche texte) : le modèle le lit comme une image.
    if (cleaned.join("").replace(/\s+/g, "").length < 20) return { text: await transcribe(userId, file, "application/pdf"), pages: cleaned.length };
    return { text: cleaned.length > 1 ? cleaned.map((t, i) => `— Page ${i + 1} —\n${t}`).join("\n\n") : (cleaned[0] ?? ""), pages: cleaned.length };
  }
  if (file.bytes.byteLength > MAX_IMAGE_BYTES) throw new ApiHttpError(`« ${file.name} » est trop volumineuse (10 Mo maximum par image).`, 413);
  return { text: await transcribe(userId, file, type), pages: 1 };
}

/**
 * Sujet importé depuis un ou plusieurs fichiers (PDF ou images). Le texte de chaque fichier s'ajoute, dans l'ordre,
 * à la suite du sujet déjà présent : on peut importer un sujet en plusieurs fois (une photo par page, par exemple).
 */
export async function importDiagramSubjectFiles(userId: string, id: string, files: SubjectFile[]) {
  const w = assertFound(await db.labWorkspace.findFirst({ where: { id, userId, kind: "DIAGRAM" }, select: { id: true, brief: true } }), "Espace de travail");
  if (!files.length) throw new ApiHttpError("Ajoutez au moins un fichier (PDF ou image).", 422);
  if (files.length > MAX_SUBJECT_FILES) throw new ApiHttpError(`${MAX_SUBJECT_FILES} fichiers au maximum par import.`, 422);
  const parts: { name: string; text: string; pages: number }[] = [];
  for (const f of files) parts.push({ name: f.name.slice(0, 160), ...(await subjectText(userId, f)) });
  const prev = (w.brief as unknown as DiagramBrief | null) ?? null;
  const before = prev?.statement?.trim() ?? "";
  const added = parts.map((p) => (parts.length > 1 || before ? `— ${p.name} —\n${p.text}` : p.text)).join("\n\n");
  const statement = [before, added].filter(Boolean).join("\n\n").slice(0, MAX_STATEMENT);
  const earlier = before ? (prev?.source?.documents ?? (prev?.source?.documentName ? [prev.source.documentName] : [])) : [];
  const documents = [...earlier, ...parts.map((p) => p.name)].slice(-30);
  const pages = (before ? (prev?.source?.pages ?? 0) : 0) + parts.reduce((n, p) => n + p.pages, 0);
  const brief: DiagramBrief = { origin: "document", statement, verified: false, source: { documentName: documents[documents.length - 1], documents, pages } };
  return db.labWorkspace.update({ where: { id }, data: { brief: brief as unknown as Prisma.InputJsonValue, mode: "EXERCISE" } });
}

/** Import d'un seul PDF (conservé pour les appels existants). */
export function importDiagramSubjectPdf(userId: string, id: string, file: SubjectFile) {
  return importDiagramSubjectFiles(userId, id, [file]);
}

// ── Assistant IA : il voit le diagramme, la sélection et le sujet ─────────────────

export const diagramAssistantSchema = z.object({
  message: z.string().trim().min(1, "Message vide.").max(2000, "Message trop long."),
  diagram: z.unknown(),
  /** Éléments sélectionnés par l'étudiant (identifiants) : « cette entité », « ce lien »… */
  selection: z.array(z.string().max(40)).max(20).default([]),
  history: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(8000) })).max(12).default([]),
});

export type DiagramAssistantEvent = { type: "delta"; text: string };

function systemPrompt(kind: DiagramKind): string {
  const notation =
    kind === "mcd"
      ? `Notation MCD (Merise) : entités (type "entity") avec un identifiant (attribut "key": true), associations (type "association", attributs éventuels, jamais d'identifiant propre), pattes (liens de type "mcd") qui relient TOUJOURS une entité ("from") à une association ("to") et portent la cardinalité côté entité dans "cardFrom" : ${MCD_CARDINALITIES.join(", ")}.`
      : `Notation UML (diagramme de classes) : classes (type "class", "attributes" avec "visibility" + - # ~ et "type", "methods" en texte libre, "stereotype" éventuel comme abstract ou interface), liens de type association, inheritance (de la classe fille "from" vers la classe mère "to"), composition et aggregation (du composant "from" vers le tout "to"), dependency ; multiplicités "cardFrom" et "cardTo" parmi ${UML_MULTIPLICITIES.join(", ")} ; "label" pour le nom du rôle ou de l'association.`;
  return `Tu es l'assistant IA intégré au laboratoire de diagrammes de Niala (${DIAGRAM_KINDS[kind]}). Tu vois le diagramme que l'étudiant a sous les yeux, les éléments qu'il a sélectionnés et le sujet de l'exercice. Tu l'aides à le construire, à le comprendre et à le corriger. Réponds en français, en vouvoyant l'étudiant, de façon concise, en Markdown simple.

${RELIABILITY_RULES}
- Appuie-toi sur le diagramme et le sujet fournis. Cite les éléments par leur nom. Si le sujet est ambigu, dis-le et propose une hypothèse explicite.
- Explique tes choix de modélisation (pourquoi telle cardinalité, pourquoi une association plutôt qu'un attribut…) : l'étudiant doit apprendre, pas seulement recopier.

${notation}

MODIFIER LE DIAGRAMME : si l'étudiant te demande de construire, compléter ou corriger le diagramme, ou si une modification concrète l'aide, ajoute À LA FIN de ta réponse un seul bloc de code \`\`\`${PROPOSAL_FENCE} contenant le diagramme COMPLET après modification, en JSON : {"kind":"${kind}","nodes":[{"id","type","name","x","y","attributes":[{"name","type?","key?","visibility?"}],"methods":[],"stereotype?","text?"}],"links":[{"id","from","to","type","cardFrom?","cardTo?","label?"}]}.
- Garde les identifiants et les positions (x, y) des éléments existants que tu ne changes pas ; place les nouveaux éléments dans les zones libres, espacés d'environ 250 px horizontalement et 200 px verticalement, coordonnées positives.
- L'étudiant verra un bouton pour appliquer ta proposition : il peut la refuser. Ne mets jamais ce bloc pour une simple explication.
- Si l'étudiant demande seulement un avis ou un indice, n'ajoute pas de bloc et ne donne pas la solution complète.

${UNTRUSTED_RULES.replace("Ne produis que le JSON demandé, sans texte autour.", "Réponds uniquement à l'étudiant.")}`;
}

export async function askDiagramAssistant(userId: string, workspaceId: string, input: z.infer<typeof diagramAssistantSchema>, emit?: (e: DiagramAssistantEvent) => void) {
  const w = await db.labWorkspace.findFirst({ where: { id: workspaceId, userId, kind: "DIAGRAM" } });
  if (!w) throw new ApiHttpError("Espace de travail introuvable.", 404);
  const provider = getProvider();
  if (!provider?.converse) throw new ApiHttpError("L'assistant nécessite le service d'IA Gemini, qui n'est pas configuré.", 503);
  try {
    await checkQuota(userId);
  } catch (e) {
    if (e instanceof AiQuotaError) throw new ApiHttpError(e.message, 429);
    throw e;
  }

  const stored = parseDiagram((w.files as unknown as { content: string }[])[0]?.content ?? "", ((w.files as unknown as { language: string }[])[0]?.language as DiagramKind) ?? "mcd");
  const shown = diagramSchema.safeParse(input.diagram);
  const diagram = shown.success ? sanitizeDiagram(shown.data) : stored;
  const brief = (w.brief as unknown as DiagramBrief | null) ?? null;

  const parts = [`Diagramme affiché à l'écran :\n${wrapUntrusted("diagramme", describeDiagram(diagram).slice(0, 12_000))}`, `Le même diagramme en JSON (positions comprises) :\n${wrapUntrusted("json", JSON.stringify(diagram).slice(0, 30_000))}`];
  const sel = diagram.nodes.filter((n) => input.selection.includes(n.id)).map((n) => n.name).concat(diagram.links.filter((l) => input.selection.includes(l.id)).map((l) => `le lien ${l.id}`));
  if (sel.length) parts.push(`Éléments sélectionnés par l'étudiant : ${sel.join(", ")}.`);
  const warnings = diagramWarnings(diagram);
  if (warnings.length) parts.push(`Vérifications automatiques de notation :\n- ${warnings.join("\n- ")}`);
  if (diagram.kind === "mcd" && diagram.nodes.length) parts.push(`Modèle logique déduit automatiquement (règles de Merise ; clé primaire encadrée de _ car soulignée à l'écran, clé étrangère précédée de #) :\n${mldText(mcdToMld(diagram))}`);
  parts.push(brief?.statement ? `Sujet de l'exercice :\n${wrapUntrusted("sujet", brief.statement.slice(0, 15_000))}` : "Aucun sujet d'exercice n'a été fourni (espace libre).");

  const turns: ChatTurn[] = [
    ...input.history.map((m): ChatTurn => ({ role: m.role === "user" ? "user" : "model", parts: [{ text: m.content }] })),
    { role: "user", parts: [{ text: `${parts.join("\n\n")}\n\nDemande de l'étudiant :\n${wrapUntrusted("question", input.message)}` }] },
  ];

  const started = Date.now();
  const system = systemPrompt(diagram.kind);
  const log = (model: string, respChars: number, ok: boolean, error?: string) => db.aIUsageLog.create({ data: { userId, op: "lab.diagram@1", model, promptChars: system.length + input.message.length, respChars, ok, error: error?.slice(0, 500) ?? null, durationMs: Date.now() - started } }).catch(() => undefined);
  try {
    // Le bloc JSON de proposition n'est pas diffusé : l'étudiant voit l'explication, puis un bouton « Appliquer ».
    let streamed = "";
    let hidden = false;
    const res = await provider.converse({
      system,
      turns,
      maxTokens: 12_000,
      temperature: 0.2,
      signal: AbortSignal.timeout(110_000),
      onText: emit
        ? (d) => {
            if (hidden) return;
            const next = streamed + d;
            const at = next.indexOf("```" + PROPOSAL_FENCE);
            if (at >= 0) {
              hidden = true;
              if (at > streamed.length) emit({ type: "delta", text: next.slice(streamed.length, at) });
              streamed = next.slice(0, at);
              return;
            }
            // Retient la fin du texte tant qu'elle pourrait être le début de la balise.
            const safe = next.length - (PROPOSAL_FENCE.length + 3);
            if (safe > streamed.length) {
              emit({ type: "delta", text: next.slice(streamed.length, safe) });
              streamed = next.slice(0, safe);
            }
          }
        : undefined,
    });
    if (!res.text.trim()) throw new AiCallError("Réponse vide.");
    await log(res.model, res.text.length, true);
    const out = extractProposal(res.text, diagram);
    return { text: out.invalid ? `${out.text}\n\n_La proposition de diagramme reçue était invalide : redemandez-la si besoin._` : out.text, proposal: out.proposal };
  } catch (e) {
    const message = e instanceof Error ? e.message : "Erreur inconnue";
    console.warn(`[lab.diagram] ${message}`);
    await log(provider.model, 0, false, message);
    throw new ApiHttpError("L'assistant est momentanément indisponible. Réessayez dans un instant.", 502);
  }
}
