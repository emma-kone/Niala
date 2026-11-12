import { NextResponse } from "next/server";
import { GATE_COOKIE, GATE_MAX_AGE, GATE_ROUTE, codeRequired, cookieIsValid, gateSlug, gateToken } from "@/server/admin/gate";
import type { NextRequest } from "next/server";

// ─────────────────────────────────────────────────────────────────────────────
// Proxy Niala.
//  1. Transmet le chemin demandé aux routes d'API (en-tête x-niala-path) : la mesure des temps de réponse
//     (RequestLog) sait ainsi de quelle route il s'agit sans que chaque route ait à le déclarer.
//  2. Lien d'administration distinct : si ADMIN_HOST est défini (ex. admin.niala.app), le back-office n'est servi QUE
//     sur ce domaine et le domaine de la plateforme ne l'expose plus ; l'inverse est vrai pour l'espace étudiant.
//     Sans ADMIN_HOST (développement), le back-office reste accessible sous /admin.
//  3. Porte d'entrée SECRÈTE : le back-office n'existe, pour quiconque, qu'après être passé par l'adresse secrète
//     /<ADMIN_PATH> (valeur définie dans l'environnement, 8 caractères minimum ; une valeur longue et aléatoire est bien plus sûre qu'un mot lisible). Cette visite dépose un cookie
//     de passage (httpOnly) ; sans lui, /admin et /api/admin répondent 404 comme n'importe quelle page inexistante,
//     de sorte qu'on ne peut ni deviner l'adresse, ni confirmer qu'un back-office existe. En production, sans ADMIN_PATH,
//     le back-office est fermé. Ce n'est qu'une première barrière : la connexion et les droits restent vérifiés côté serveur.
//  4. Garde-fous contre les abus, avant tout traitement coûteux (base de données, rendu) :
//     - inondation : au-delà d'un débit qu'aucun usage normal n'atteint, une adresse IP reçoit 429 ;
//     - requêtes d'écriture venues d'un autre site (CSRF) : refusées d'après les en-têtes Origin / Sec-Fetch-Site ;
//     - corps de requête démesurés : refusés d'après Content-Length, sans être lus.
//     La défense contre une attaque DISTRIBUÉE (DDoS) relève de l'hébergeur (pare-feu Vercel) : voir docs/SECURITE.md.
//  La vérification des droits n'est jamais faite ici : elle l'est côté serveur à chaque requête (server/admin/session.ts).
// ─────────────────────────────────────────────────────────────────────────────

const ADMIN_HOST = (process.env.ADMIN_HOST ?? "").trim().toLowerCase();

function hasGate(req: NextRequest, slug: string): boolean {
  return cookieIsValid(req.cookies.get(GATE_COOKIE)?.value, slug);
}
const notFound = () => new NextResponse("Introuvable", { status: 404 });
/** Refus de la porte secrète : la requête est réécrite vers une page inexistante, si bien que la réponse est la 404 habituelle du site (rien ne trahit un back-office). */
const absent = (req: NextRequest) => NextResponse.rewrite(new URL("/__niala_absent__", req.url));

const isAdminPath = (p: string) => p === "/admin" || p.startsWith("/admin/") || p.startsWith("/api/admin/");
/** Chemins partagés entre les deux domaines : ressources statiques, retour Google. */
const isShared = (p: string) => p.startsWith("/_next/") || p === "/auth/callback" || p === "/favicon.ico" || p === "/icon.png" || p === "/apple-icon.png" || p === "/manifest.webmanifest" || p.startsWith("/api/track");

// ── Inondation ───────────────────────────────────────────────────────────────
// Compteur par adresse IP et par instance. Le plafond est large (plusieurs dizaines d'étudiants derrière la même adresse
// d'un établissement restent en dessous) : il ne vise que le martèlement d'une seule source.
const FLOOD_WINDOW_MS = 10_000;
const FLOOD_MAX = Math.max(50, Number(process.env.FLOOD_MAX_PER_10S) || 400);
const FLOOD_MAX_KEYS = 20_000;
const floodBuckets = new Map<string, { count: number; reset: number }>();

function clientIp(req: NextRequest): string | null {
  return (req.headers.get("x-forwarded-for") ?? "").split(",")[0]?.trim() || req.headers.get("x-real-ip") || null;
}

/** Secondes à attendre si l'adresse dépasse le débit autorisé, sinon 0. Sans adresse connue (développement local), aucun plafond. */
function floodRetryAfter(req: NextRequest, now = Date.now()): number {
  const ip = clientIp(req);
  if (!ip) return 0;
  if (floodBuckets.size > FLOOD_MAX_KEYS) for (const [k, b] of floodBuckets) if (b.reset < now) floodBuckets.delete(k);
  const bucket = floodBuckets.get(ip);
  if (!bucket || bucket.reset < now) {
    // Table saturée d'adresses actives : on ne mémorise plus de nouvelle adresse plutôt que de laisser la mémoire enfler.
    if (floodBuckets.size <= FLOOD_MAX_KEYS) floodBuckets.set(ip, { count: 1, reset: now + FLOOD_WINDOW_MS });
    return 0;
  }
  bucket.count += 1;
  return bucket.count > FLOOD_MAX ? Math.max(1, Math.ceil((bucket.reset - now) / 1000)) : 0;
}

// ── Écritures venues d'un autre site (CSRF) ──────────────────────────────────
const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
/** Désinscription « un clic » (RFC 8058) : appelée par les messageries, sans cookie, protégée par son propre jeton. */
const CROSS_SITE_ALLOWED = new Set(["/api/desinscription"]);
const hostOf = (value: string | null | undefined) => {
  const v = (value ?? "").trim().toLowerCase();
  if (!v) return "";
  try {
    return new URL(v.includes("://") ? v : `https://${v}`).host;
  } catch {
    return "";
  }
};

/** Vrai si une requête d'écriture vers l'API provient d'une page d'un autre site. Un client sans navigateur (aucun de ces en-têtes) n'est pas concerné. */
function isCrossSiteWrite(req: NextRequest, pathname: string): boolean {
  if (!UNSAFE_METHODS.has(req.method) || CROSS_SITE_ALLOWED.has(pathname)) return false;
  const origin = req.headers.get("origin");
  if (!origin) return req.headers.get("sec-fetch-site") === "cross-site";
  const from = hostOf(origin);
  if (!from) return true; // « null » (page isolée) ou origine illisible
  const own = [req.headers.get("host"), req.headers.get("x-forwarded-host"), req.nextUrl.host, process.env.APP_URL, ADMIN_HOST].map(hostOf).filter(Boolean);
  return !own.includes(from);
}

// ── Corps démesurés ──────────────────────────────────────────────────────────
const MAX_UPLOAD_BYTES = 64 * 1024 * 1024; // dépôt de fichiers (60 Mo acceptés par la route)
const MAX_BODY_BYTES = 25 * 1024 * 1024; // tout le reste de l'API
const bodyTooLarge = (req: NextRequest, pathname: string) => Number(req.headers.get("content-length") ?? 0) > (pathname.startsWith("/api/uploads/") ? MAX_UPLOAD_BYTES : MAX_BODY_BYTES);

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  const retryAfter = floodRetryAfter(req);
  if (retryAfter) return new NextResponse("Trop de requêtes.", { status: 429, headers: { "Retry-After": String(retryAfter), "Cache-Control": "no-store" } });
  if (pathname.startsWith("/api/")) {
    if (isCrossSiteWrite(req, pathname)) return NextResponse.json({ error: "Requête refusée : origine non autorisée." }, { status: 403 });
    if (bodyTooLarge(req, pathname)) return NextResponse.json({ error: "Corps de requête trop volumineux." }, { status: 413 });
  }

  // Porte secrète : /<ADMIN_PATH>[/suite] dépose le cookie de passage puis redirige vers /admin[/suite].
  const slug = gateSlug();
  if (slug && (pathname === `/${slug}` || pathname.startsWith(`/${slug}/`))) {
    // Avec un code d'accès configuré, l'adresse secrète affiche d'abord la page du code (réécriture : l'adresse ne change pas).
    if (codeRequired() && !hasGate(req, slug)) return NextResponse.rewrite(new URL(GATE_ROUTE, req.url));
    const rest = pathname.slice(slug.length + 1);
    const res = NextResponse.redirect(new URL(`/admin${rest === "/" ? "" : rest}${req.nextUrl.search}`, req.url));
    res.cookies.set(GATE_COOKIE, gateToken(slug), { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: GATE_MAX_AGE });
    res.headers.set("Cache-Control", "no-store");
    return res;
  }
  // La page du code n'est jamais accessible directement (ni ses actions) : seule la réécriture ci-dessus y mène.
  if (pathname === GATE_ROUTE || pathname.startsWith(`${GATE_ROUTE}/`)) return absent(req);
  if (isAdminPath(pathname)) {
    const open = slug ? hasGate(req, slug) : process.env.NODE_ENV !== "production";
    if (!open) return absent(req);
  }

  if (ADMIN_HOST) {
    const host = (req.headers.get("host") ?? "").toLowerCase().split(":")[0];
    const onAdminHost = host === ADMIN_HOST.split(":")[0];
    if (onAdminHost) {
      if (pathname === "/") return NextResponse.redirect(new URL("/admin", req.url));
      if (!isAdminPath(pathname) && !isShared(pathname)) return new NextResponse("Introuvable", { status: 404 });
    } else if (isAdminPath(pathname)) {
      return new NextResponse("Introuvable", { status: 404 });
    }
  }

  // Visiteur sans session : « / » présente Niala (page d'accueil) au lieu de renvoyer vers la connexion.
  if (pathname === "/" && !req.cookies.get("sfs_session")?.value) return NextResponse.rewrite(new URL("/accueil", req.url));

  if (pathname.startsWith("/api/")) {
    const headers = new Headers(req.headers);
    headers.set("x-niala-path", pathname);
    headers.set("x-niala-method", req.method);
    return NextResponse.next({ request: { headers } });
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|.*\\.(?:png|jpg|jpeg|svg|ico|webp|woff2?|ttf|css|js|map)$).*)"],
};
