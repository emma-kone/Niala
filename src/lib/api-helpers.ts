import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { AuthError, rateLimit } from "@/lib/auth";
import { durableLimit } from "@/lib/rate-limit";
import { classifyError, classifyStatus, logRequest, pathOfRequest } from "@/server/analytics/request-log";

/** Erreur métier avec code HTTP explicite (404, 409…). */
export class ApiHttpError extends Error {
  status: number;
  extra?: Record<string, unknown>;
  constructor(message: string, status = 400, extra?: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

export function jsonError(message: string, status = 400, extra?: Record<string, unknown>) {
  return NextResponse.json({ error: message, ...extra }, { status });
}

/**
 * Erreurs de base de données qui ont une réponse utile pour l'étudiant, au lieu d'une erreur 500 anonyme. Le code Prisma
 * est lu par son nom de classe et son code (pas d'import du client ici : ce fichier est aussi chargé hors base).
 */
export function databaseHttpError(err: unknown): { status: number; message: string } | null {
  if (!(err instanceof Error)) return null;
  const name = err.constructor.name;
  const code = (err as { code?: unknown }).code;
  // Base injoignable, groupe de connexions saturé, transaction expirée ou en conflit : rien n'a été enregistré, un nouvel essai suffit.
  const busy = new Set(["P1001", "P1002", "P1008", "P1017", "P2024", "P2028", "P2034"]);
  if (name === "PrismaClientInitializationError" || (name === "PrismaClientKnownRequestError" && typeof code === "string" && busy.has(code))) {
    return { status: 503, message: "La base de données met trop de temps à répondre : rien n'a été enregistré. Réessayez dans un instant." };
  }
  if (name !== "PrismaClientKnownRequestError") return null;
  if (code === "P2025") return { status: 404, message: "Élément introuvable : il a peut-être été supprimé entre-temps. Actualisez la page." };
  if (code === "P2002") return { status: 409, message: "Cet élément existe déjà." };
  if (code === "P2003") return { status: 409, message: "Opération impossible : un élément lié n'existe plus. Actualisez la page puis réessayez." };
  return null;
}

/** Enveloppe standard : auth → validation → logique, erreurs centralisées. */
export async function handle<T>(fn: () => Promise<T>): Promise<NextResponse> {
  const started = performance.now();
  // Le chemin n'est lu que pour la mesure : l'enregistrement part sans attente (voir server/analytics/request-log.ts).
  const measure = async (status: number, err?: unknown) => {
    const request = await pathOfRequest();
    if (!request) return;
    logRequest({ path: request.path, method: request.method, status, durationMs: performance.now() - started, kind: err === undefined ? classifyStatus(status) : classifyError(err, status), summary: err instanceof Error && status >= 500 ? err.constructor.name : undefined });
  };
  try {
    const data = await fn();
    // Certaines routes renvoient déjà une NextResponse (ex. 401 de login) :
    // la restituer telle quelle au lieu de la sérialiser en {}.
    if (data instanceof NextResponse) {
      await measure(data.status);
      return data;
    }
    if (data instanceof Response) {
      await measure(data.status);
      return data as unknown as NextResponse;
    }
    await measure(200);
    return NextResponse.json(data ?? { ok: true });
  } catch (err) {
    if (err instanceof AuthError) return (await measure(401, err), jsonError("Authentification requise.", 401));
    if (err instanceof ApiHttpError) return (await measure(err.status, err), jsonError(err.message, err.status, err.extra));
    if (err instanceof ZodError) {
      await measure(422, err);
      return jsonError("Données invalides : " + err.issues.map((i) => `${i.path.join(".")} — ${i.message}`).join("; "), 422);
    }
    // Le détail reste dans les logs serveur ; le client reçoit un message générique
    // et un identifiant de corrélation pour retrouver l'erreur.
    const ref = Math.random().toString(36).slice(2, 10);
    console.error(`[API ${ref}]`, err);
    const known = databaseHttpError(err);
    if (known) {
      await measure(known.status, err);
      return jsonError(known.status === 503 ? `${known.message} (réf. ${ref})` : known.message, known.status);
    }
    await measure(500, err);
    return jsonError(`Une erreur interne est survenue (réf. ${ref}).`, 500);
  }
}

/** Adresse du client telle que transmise par l'hébergeur (première adresse de x-forwarded-for). */
export function clientIp(req: Request): string {
  return (req.headers.get("x-forwarded-for") ?? "").split(",")[0]?.trim() || req.headers.get("x-real-ip") || "inconnue";
}

export function limit(key: string, max: number, windowMs: number) {
  if (!rateLimit(key, max, windowMs)) {
    throw new ApiHttpError("Trop de requêtes — patientez un instant avant de réessayer.", 429);
  }
}

/**
 * Même limite, mais comptée en base : commune à toutes les instances du serveur. À utiliser sur les routes ouvertes sans
 * session (connexion, inscription, mot de passe oublié, assistance), celles qu'un attaquant martèle.
 */
export async function limitDurable(key: string, max: number, windowMs: number) {
  if (!(await durableLimit(key, max, windowMs))) {
    throw new ApiHttpError("Trop de requêtes — patientez un instant avant de réessayer.", 429);
  }
}

export async function readJson<T>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new ApiHttpError("Corps de requête JSON invalide.", 400);
  }
}
