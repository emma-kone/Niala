import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
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
