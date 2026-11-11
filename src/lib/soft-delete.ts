import { Prisma } from "@prisma/client";

// ─────────────────────────────────────────────────────────────────────────────
// Suppression « douce ». Un contenu supprimé par l'étudiant n'est PAS effacé : il reçoit une date `deletedAt`, disparaît
// de l'application, mais reste en base pour les statistiques et analyses de l'administration.
//
//  - `aliveFilter(model)` : condition « encore visible » d'un modèle, calculée à partir du schéma. Elle couvre le modèle
//    lui-même (deletedAt IS NULL) ET ses ancêtres reliés par une cascade : les versions d'un document supprimé, les
//    tentatives d'un exercice supprimé, les messages d'une conversation supprimée… disparaissent comme elles
//    disparaissaient avant, quand la base les effaçait en cascade. L'étudiant voit donc exactement ce qu'il voyait.
//  - `softDeleteExtension` : appliquée au client `db`, elle ajoute ce filtre à toutes les lectures et mises à jour, et
//    REFUSE toute suppression définitive d'un modèle à suppression douce (un oubli échoue au lieu d'effacer des données).
//  - `softDelete(tx, model, where)` : marque les lignes et, en cascade, leurs contenus dépendants.
//  - Les statistiques de l'administration lisent tout (SQL brut ou client `dbAll` non filtré).
// ─────────────────────────────────────────────────────────────────────────────

export const SOFT_MODELS = [
  "Subject",
  "Folder",
  "Document",
  "Exercise",
  "MindMap",
  "Conversation",
  "Note",
  "NoteLink",
  "AcademicTask",
  "StudySession",
  "ScheduleBreak",
  "ScheduleEvent",
  "ScheduleImport",
  "LabWorkspace",
  "Concept",
  "CourseSection",
  "SupportRequest", // supprimée par l'équipe (back-office)
  "Announcement", // supprimée par l'équipe (back-office)
] as const;
export type SoftModel = (typeof SOFT_MODELS)[number];
const SOFT = new Set<string>(SOFT_MODELS);
export const isSoftModel = (m: string | undefined): m is SoftModel => !!m && SOFT.has(m);

type Where = Record<string, unknown>;
type Field = (typeof Prisma.dmmf.datamodel.models)[number]["fields"][number];

const MODELS = new Map(Prisma.dmmf.datamodel.models.map((m) => [m.name, m]));

/** Relations portées par `model` (clé étrangère chez lui) vers un parent dont la suppression l'effaçait en cascade. */
function cascadeParents(model: string): Field[] {
  return (MODELS.get(model)?.fields ?? []).filter((f) => f.kind === "object" && (f.relationFromFields?.length ?? 0) > 0 && f.relationOnDelete === "Cascade" && f.type !== "User");
}

const aliveCache = new Map<string, Where | null>();

/** Condition « visible » d'un modèle (null si le modèle n'est concerné par aucune suppression douce). */
export function aliveFilter(model: string, visiting: Set<string> = new Set()): Where | null {
  if (aliveCache.has(model)) return aliveCache.get(model)!;
  if (visiting.has(model) || visiting.size > 6) return null;
  visiting.add(model);
  const parts: Where[] = SOFT.has(model) ? [{ deletedAt: null }] : [];
  for (const f of cascadeParents(model)) {
    const inner = aliveFilter(f.type, visiting);
    if (!inner) continue;
    parts.push(f.isRequired ? { [f.name]: { is: inner } } : { OR: [{ [f.name]: { is: null } }, { [f.name]: { is: inner } }] });
  }
  visiting.delete(model);
  const result = parts.length === 0 ? null : parts.length === 1 ? parts[0] : { AND: parts };
  aliveCache.set(model, result);
  return result;
}

/** Ajoute la condition « visible » à un filtre, sauf si l'appelant filtre lui-même sur deletedAt (lecture volontaire). */
export function withAlive(model: string, where: Where | undefined): Where | undefined {
  const alive = aliveFilter(model);
  if (!alive) return where;
  if (!where) return alive;
  if ("deletedAt" in where) return where;
  const and = where.AND === undefined ? [] : Array.isArray(where.AND) ? where.AND : [where.AND];
  return { ...where, AND: [...and, alive] };
}

const FILTERED = new Set(["findUnique", "findUniqueOrThrow", "findFirst", "findFirstOrThrow", "findMany", "count", "aggregate", "groupBy", "update", "updateMany", "updateManyAndReturn", "upsert"]);

export class HardDeleteError extends Error {
  constructor(model: string) {
    super(`Suppression définitive interdite sur ${model} : utilisez softDelete() (les contenus supprimés restent en base pour les statistiques).`);
  }
}

export const softDeleteExtension = Prisma.defineExtension({
  name: "soft-delete",
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        if ((operation === "delete" || operation === "deleteMany") && isSoftModel(model)) throw new HardDeleteError(model);
        if (FILTERED.has(operation) && aliveFilter(model)) {
          const a = (args ?? {}) as { where?: Where };
          return query({ ...a, where: withAlive(model, a.where) } as typeof args);
        }
        return query(args);
      },
    },
  },
});

// ── Marquage ─────────────────────────────────────────────────────────────────

const delegateName = (model: string) => model.charAt(0).toLowerCase() + model.slice(1);

interface Delegate {
  findMany(args: { where: Where; select: { id: true } }): Promise<{ id: string }[]>;
  updateMany(args: { where: Where; data: Where }): Promise<{ count: number }>;
}

/** Modèles à suppression douce effacés autrefois en cascade avec `model`, et leur clé étrangère. */
function cascadeChildren(model: string): { model: SoftModel; fk: string }[] {
  const out: { model: SoftModel; fk: string }[] = [];
  for (const child of SOFT_MODELS) {
    for (const f of cascadeParents(child)) if (f.type === model && f.relationFromFields?.length === 1) out.push({ model: child, fk: f.relationFromFields[0] });
  }
  return out;
}

/** Client ou transaction Prisma (le client filtré `db` ou un `tx` de transaction). */
type Client = { $executeRaw: (query: TemplateStringsArray | Prisma.Sql, ...values: unknown[]) => Prisma.PrismaPromise<number> };

/**
 * Marque comme supprimées les lignes visibles de `model` correspondant à `where`, puis leurs contenus dépendants.
 * Les noms soumis à une contrainte d'unicité (dossiers, notions) sont suffixés pour qu'un nouvel élément du même nom
 * puisse être créé. Renvoie les identifiants marqués.
 */
export async function softDelete(client: unknown, model: SoftModel, where: Where, now = new Date()): Promise<string[]> {
  const c = client as Client & Record<string, Delegate>;
  const delegate = c[delegateName(model)];
  const ids = (await delegate.findMany({ where, select: { id: true } })).map((r) => r.id);
  if (!ids.length) return [];
  // Les contenus dépendants d'abord : une fois le parent marqué, le filtre « visible » ne les retrouverait plus.
  for (const child of cascadeChildren(model)) await softDelete(client, child.model, { [child.fk]: { in: ids } }, now);
  await delegate.updateMany({ where: { id: { in: ids } }, data: { deletedAt: now } });
  if (model === "Folder") await c.$executeRaw`UPDATE "Folder" SET name = name || ' [supprimé ' || id || ']' WHERE id = ANY(${ids})`;
  if (model === "Concept") await c.$executeRaw`UPDATE "Concept" SET "normalizedName" = "normalizedName" || ' [supprimé ' || id || ']' WHERE id = ANY(${ids})`;
  // Relations « SetNull » : comme quand la base effaçait le parent, le lien est retiré sur les lignes encore visibles
  // (cours d'agenda d'une matière supprimée, nœud de carte d'une notion supprimée…). SQL direct : la date de mise à jour
  // n'est pas modifiée, exactement comme avec la contrainte de la base.
  for (const rel of setNullReferences(model)) {
    const alive = isSoftModel(rel.model) ? Prisma.sql` AND "deletedAt" IS NULL` : Prisma.empty;
    await c.$executeRaw`UPDATE ${Prisma.raw(`"${rel.table}"`)} SET ${Prisma.raw(`"${rel.column}"`)} = NULL WHERE ${Prisma.raw(`"${rel.column}"`)} = ANY(${ids})${alive}`;
  }
  return ids;
}

/**
 * Liens conservés malgré la suppression du parent, parce que les statistiques en ont besoin : une tentative reste rattachée
 * à son exercice (et donc à sa matière). Côté étudiant, ces tentatives sont lues en filtrant sur l'exercice visible.
 */
const KEEP_LINKS = new Set(["ExerciseAttempt.exercise"]);

/** Colonnes qui référencent `model` avec « onDelete: SetNull » (table et colonne SQL). */
function setNullReferences(model: string): { model: string; table: string; column: string }[] {
  const out: { model: string; table: string; column: string }[] = [];
  for (const m of MODELS.values()) {
    for (const f of m.fields) {
      if (f.kind !== "object" || f.type !== model || f.relationOnDelete !== "SetNull" || f.relationFromFields?.length !== 1 || KEEP_LINKS.has(`${m.name}.${f.name}`)) continue;
      const scalar = m.fields.find((x) => x.name === f.relationFromFields![0]);
      out.push({ model: m.name, table: m.dbName ?? m.name, column: scalar?.dbName ?? f.relationFromFields[0] });
    }
  }
  return out;
}
