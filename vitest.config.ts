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
  },
});
