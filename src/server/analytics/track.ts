import { hmacFor } from "@/lib/auth";
import { db } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import type { EventType, ModuleKey } from "@/server/analytics/definitions";

// ─────────────────────────────────────────────────────────────────────────────
// Collecte des événements d'usage. Principes :
//  - l'utilisateur est PSEUDONYMISÉ (HMAC de son identifiant, clé = secret de l'application) : aucune adresse, aucun
//    nom, aucun contenu de travail n'est enregistré ;
//  - la collecte ne ralentit jamais l'espace étudiant : elle est lancée sans attente et ses erreurs sont avalées ;
//  - les métadonnées (props) sont de petits objets techniques (type d'exercice, langage, matière en clair interdite).
// ─────────────────────────────────────────────────────────────────────────────

export const actorKeyOf = (userId: string) => hmacFor("analytics-actor", userId);

export interface TrackOptions {
  module?: ModuleKey | string;
  ok?: boolean;
  durationMs?: number;
  props?: Record<string, string | number | boolean | null>;
  /** Pour les événements reconstitués depuis les tables d'origine : date réelle et identifiant de la ligne source. */
  at?: Date;
  source?: "LIVE" | "BACKFILL";
  sourceRef?: string;
  /** Catégorie déjà connue (évite une lecture du profil). */
  category?: string | null;
}

const categoryCache = new Map<string, { value: string | null; at: number }>();
const CATEGORY_TTL_MS = 10 * 60_000;

async function categoryOf(userId: string): Promise<string | null> {
  const hit = categoryCache.get(userId);
  if (hit && Date.now() - hit.at < CATEGORY_TTL_MS) return hit.value;
  const profile = await db.studentProfile.findUnique({ where: { userId }, select: { category: true } });
  const value = profile?.category ?? null;
  if (categoryCache.size > 5000) categoryCache.clear();
  categoryCache.set(userId, { value, at: Date.now() });
  return value;
}

/** Enregistre un événement. Ne lève jamais : un échec de collecte ne doit pas casser l'action de l'étudiant. */
export async function recordEvent(userId: string, type: EventType, opts: TrackOptions = {}): Promise<void> {
  try {
    const data: Prisma.AnalyticsEventUncheckedCreateInput = {
      type,
      module: opts.module ?? null,
      actorKey: actorKeyOf(userId),
      category: opts.category !== undefined ? opts.category : await categoryOf(userId),
      source: opts.source ?? "LIVE",
      sourceRef: opts.sourceRef ?? null,
      ok: opts.ok ?? true,
      durationMs: opts.durationMs ?? null,
      props: opts.props ?? undefined,
      ...(opts.at ? { createdAt: opts.at } : {}),
    };
    if (opts.sourceRef) {
      await db.analyticsEvent.upsert({ where: { type_sourceRef: { type, sourceRef: opts.sourceRef } }, create: data, update: {} });
    } else {
      await db.analyticsEvent.create({ data });
    }
  } catch (e) {
    if (process.env.NODE_ENV !== "production") console.warn("[analytics] événement ignoré :", e instanceof Error ? e.message : e);
  }
}

/** Version « sans attente » à utiliser dans les services : la promesse n'est jamais à attendre ni à intercepter. */
export function track(userId: string, type: EventType, opts: TrackOptions = {}): void {
  void recordEvent(userId, type, opts);
}

export function forgetCategory(userId: string) {
  categoryCache.delete(userId);
}
