import { headers } from "next/headers";
import { db } from "@/lib/db";
import { computeStreak, resolveActivityDay, streakMessage, type StreakView } from "@/server/domain/streak";

// ─────────────────────────────────────────────────────────────────────────────
// Série de jours d'activité. L'enregistrement est une écriture unique et légère (une ligne par étudiant et par jour),
// lancée sans attente : elle ne ralentit aucune route et n'ajoute aucune lecture. Le calcul se fait à la lecture.
// ─────────────────────────────────────────────────────────────────────────────

/** En-tête envoyé par le navigateur : date AAAA-MM-JJ de l'appareil de l'étudiant. */
export const ACTIVITY_DATE_HEADER = "x-niala-date";

/** Jours déjà enregistrés par cette instance : évite de répéter l'écriture à chaque action de la journée. */
const recorded = new Set<string>();
const MAX_REMEMBERED = 5000;

/** Lit l'en-tête tout de suite (contexte de la requête encore actif) ; hors requête (tests, scripts) : aucune date. */
function claimedDate(): Promise<string | null> {
  try {
    return headers().then((h) => h.get(ACTIVITY_DATE_HEADER), () => null);
  } catch {
    return Promise.resolve(null);
  }
}

/** Écrit le jour d'activité ; n'échoue jamais. `day` explicite pour les tests et les scripts. */
export async function recordActivity(userId: string, day?: string): Promise<void> {
  const claimed = day ? null : claimedDate(); // appelé avant tout `await`
  try {
    const date = day ?? resolveActivityDay(await claimed, new Date());
    const key = `${userId}:${date}`;
    if (recorded.has(key)) return;
    await db.activityDay.createMany({ data: [{ userId, day: date }], skipDuplicates: true });
    if (recorded.size >= MAX_REMEMBERED) recorded.clear();
    recorded.add(key);
  } catch {
    // la série est un bonus de motivation : une erreur ici ne doit jamais faire échouer l'action de l'étudiant
  }
}

/** Version « sans attente » à appeler depuis les services. */
export function markActivity(userId: string): void {
  void recordActivity(userId);
}

/** Série de l'étudiant à la date `today` de son appareil. Une seule lecture, d'une colonne. */
export async function getStreak(userId: string, today: string): Promise<StreakView & { message: string }> {
  const rows = await db.activityDay.findMany({ where: { userId }, select: { day: true }, take: 3700 });
  const streak = computeStreak(rows.map((r) => r.day), today);
  return { ...streak, message: streakMessage(streak) };
}

/** Pour les tests : oublie les jours mémorisés. */
export function resetStreakCache() {
  recorded.clear();
}
