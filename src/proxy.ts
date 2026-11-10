import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// ─────────────────────────────────────────────────────────────────────────────
// Proxy Niala.
//  1. Transmet le chemin demandé aux routes d'API (en-tête x-niala-path) : la mesure des temps de réponse
//     (RequestLog) sait ainsi de quelle route il s'agit sans que chaque route ait à le déclarer.
//  2. Lien d'administration distinct : si ADMIN_HOST est défini (ex. admin.niala.app), le back-office n'est servi QUE
//     sur ce domaine et le domaine de la plateforme ne l'expose plus ; l'inverse est vrai pour l'espace étudiant.
//     Sans ADMIN_HOST (développement), le back-office reste accessible sous /admin.
//  La vérification des droits n'est jamais faite ici : elle l'est côté serveur à chaque requête (server/admin/session.ts).
// ─────────────────────────────────────────────────────────────────────────────

const ADMIN_HOST = (process.env.ADMIN_HOST ?? "").trim().toLowerCase();

const isAdminPath = (p: string) => p === "/admin" || p.startsWith("/admin/") || p.startsWith("/api/admin/");
/** Chemins partagés entre les deux domaines : ressources statiques, retour Google. */
const isShared = (p: string) => p.startsWith("/_next/") || p === "/auth/callback" || p === "/favicon.ico" || p === "/icon.png" || p === "/apple-icon.png" || p === "/manifest.webmanifest" || p.startsWith("/api/track");

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

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
