import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
    // Chaque fichier d'intégration démarre sa propre base PGlite : on borne la charge et on laisse le temps.
    hookTimeout: 120_000,
    testTimeout: 60_000,
    maxWorkers: 4,
    // Les tests ne contactent jamais un vrai fournisseur IA, même si .env contient des clés (Prisma le charge).
    // Même garde pour la base : sans cette adresse fictive, un client Prisma créé trop tôt lirait celle de production dans .env.
    env: { GEMINI_API_KEY: "", ANTHROPIC_API_KEY: "", DATABASE_URL: "postgresql://test:test@127.0.0.1:1/garde_tests", DIRECT_URL: "postgresql://test:test@127.0.0.1:1/garde_tests" },
  },
});
