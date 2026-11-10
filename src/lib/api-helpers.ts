import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { AuthError, rateLimit } from "@/lib/auth";
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
    await measure(500, err);
    return jsonError(`Une erreur interne est survenue (réf. ${ref}).`, 500);
  }
}

export function limit(key: string, max: number, windowMs: number) {
  if (!rateLimit(key, max, windowMs)) {
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
