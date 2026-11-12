import type { NextConfig } from "next";

// ── En-têtes de sécurité (OWASP) ─────────────────────────────────────────────
// Envoyés avec toutes les réponses. La politique de contenu (CSP) limite d'où le navigateur peut charger scripts, styles,
// images et connexions : une injection éventuelle ne peut ni charger un script hébergé ailleurs, ni exfiltrer des données
// vers un domaine tiers, ni afficher Niala dans le cadre d'un autre site (détournement de clic).
const isDev = process.env.NODE_ENV !== "production";
const supabaseOrigin = (() => {
  try {
    return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").origin;
  } catch {
    return "";
  }
})();

const csp = [
  "default-src 'self'",
  // 'unsafe-inline' : script d'initialisation du thème et données d'hydratation de Next ; 'wasm-unsafe-eval' : lecteur PDF.
  `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  // Supabase : connexion Google et dépôt direct des fichiers.
  `connect-src 'self' ${supabaseOrigin} https://*.supabase.co wss://*.supabase.co${isDev ? " ws: http://localhost:* http://127.0.0.1:*" : ""}`.replace(/\s+/g, " "),
  "worker-src 'self' blob:",
  "frame-src 'self' blob:",
  "media-src 'self' blob: data:",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'",
  ...(isDev ? [] : ["upgrade-insecure-requests"]),
].join("; ");

const securityHeaders = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
  { key: "X-DNS-Prefetch-Control", value: "off" },
];

const nextConfig: NextConfig = {
  output: "standalone",
  // Ne pas annoncer la technologie du serveur (en-tête X-Powered-By).
  poweredByHeader: false,
  async headers() {
    return [
      { source: "/(.*)", headers: securityHeaders },
      // Les routes d'API qui servent des fichiers posent leur propre politique, plus stricte (bac à sable) : la CSP des pages ne s'y ajoute pas.
      { source: "/((?!api/).*)", headers: [{ key: "Content-Security-Policy", value: csp }] },
    ];
  },
  // Permet de lancer une seconde instance (scripts/dev-local.mjs) sans verrou sur .next
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // Le runner d'exécution isolée (src/server/labs/runner) est lancé comme processus Node séparé : Next ne le
  // voit pas dans le graphe d'imports. On force l'inclusion du script et de ses moteurs WebAssembly.
  outputFileTracingIncludes: {
    "/api/**": [
      "./src/server/labs/runner/child.mjs",
      "./node_modules/quickjs-emscripten/**/*",
      "./node_modules/quickjs-emscripten-core/**/*",
      "./node_modules/@jitl/**/*",
      "./node_modules/pyodide/**/*",
      "./node_modules/sql.js/**/*",
      "./node_modules/sucrase/**/*",
      "./node_modules/@jridgewell/**/*",
      "./node_modules/ts-interface-checker/**/*",
      "./node_modules/lines-and-columns/**/*",
    ],
  },
  experimental: {
    // Un module déjà visité se rouvre instantanément depuis le cache du navigateur (sans écran de chargement) ;
    // ses données sont ensuite rafraîchies en arrière-plan par le module lui-même.
    staleTimes: { dynamic: 180, static: 600 },
  },
  reactStrictMode: false,
  allowedDevOrigins: ["192.168.229.1"],
};

export default nextConfig;
