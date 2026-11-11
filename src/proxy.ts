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

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

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
