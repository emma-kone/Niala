import { headers } from "next/headers";
import { ZodError } from "zod";
import { db } from "@/lib/db";

// ─────────────────────────────────────────────────────────────────────────────
// Mesure des requêtes d'API pour la supervision technique : route, méthode, statut, durée, classe d'erreur.
// Jamais de corps de requête, jamais d'identifiant d'utilisateur : le contenu privé n'entre pas dans les journaux techniques.
// Classes d'erreur : USER (requête invalide, droits, quota), APP (défaut de l'application), EXTERNAL (IA, stockage, services tiers).
// ─────────────────────────────────────────────────────────────────────────────

export type ErrorKind = "USER" | "APP" | "EXTERNAL";

const EXTERNAL_NAMES = new Set(["AiCallError", "AiUnavailableError", "WebSearchUnavailableError", "StorageError"]);

export function classifyStatus(status: number): ErrorKind | null {
  if (status < 400) return null;
  if (status < 500) return "USER";
  return status === 502 || status === 503 || status === 504 ? "EXTERNAL" : "APP";
}

export function classifyError(err: unknown, status: number): ErrorKind | null {
  if (err instanceof ZodError) return "USER";
  if (err instanceof Error && EXTERNAL_NAMES.has(err.constructor.name)) return "EXTERNAL";
  return classifyStatus(status);
}

/** Rubrique fonctionnelle d'une route d'API (pour filtrer la supervision par module). */
export function moduleOfRoute(route: string): string {
  const seg = route.split("/").filter(Boolean);
  const [, a, b] = seg;
  switch (a) {
    case "exercises":
    case "attempts":
      return "exercises";
    case "files":
    case "uploads":
    case "folders":
    case "analysis":
      return "documents";
    case "subjects":
      return b === "maps" ? "maps" : "subjects";
    case "maps":
      return "maps";
    case "conversations":
      return "assistant";
    case "labs":
    case "execute":
      return "code";
    case "sql":
      return "sql";
    case "notes":
      return "notes";
    case "agenda":
      return "agenda";
    case "progress":
    case "recommendations":
    case "dashboard":
      return "progress";
    case "auth":
    case "account":
    case "profile":
    case "settings":
      return "account";
    default:
      return a ?? "other";
  }
}

/** Remplace les identifiants dynamiques par des jetons pour regrouper les routes : /api/files/abc123/text → /api/files/:id/text. */
export function normalizeRoute(path: string): string {
  return path
    .split("/")
    .map((s) => (/^[a-z0-9]{20,}$/i.test(s) || /^\d+$/.test(s) ? ":id" : s))
    .join("/");
}

let sinceLastPurge = 0;
const RETENTION_DAYS = 90;

export async function pathOfRequest(): Promise<{ path: string; method: string } | null> {
  try {
    const h = await headers();
    const path = h.get("x-niala-path");
    return path ? { path, method: h.get("x-niala-method") ?? "GET" } : null; // null hors d'une requête (tests, scripts)
  } catch {
    return null;
  }
}

/** Enregistre la requête sans jamais retarder ni faire échouer la réponse. */
export function logRequest(entry: { path: string | null; method: string; status: number; durationMs: number; kind: ErrorKind | null; summary?: string }) {
  const { path } = entry;
  if (!path || path.startsWith("/api/admin/") || path.startsWith("/api/track")) return;
  const route = normalizeRoute(path);
  void db.requestLog
    .create({ data: { route, method: entry.method, status: entry.status, durationMs: Math.max(0, Math.round(entry.durationMs)), module: moduleOfRoute(route), errorKind: entry.kind, errorSummary: entry.summary?.slice(0, 200) ?? null } })
    .then(async () => {
      if (++sinceLastPurge >= 500) {
        sinceLastPurge = 0;
        await db.requestLog.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - RETENTION_DAYS * 86_400_000) } } });
      }
    })
    .catch(() => undefined);
}
