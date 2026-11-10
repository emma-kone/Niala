// Lance Next.js sur un port à part contre une base PGlite locale (scripts/dev-db.mjs), pour développer le back-office
// sans toucher à Supabase ni gêner une autre instance. Usage : PGLITE_PORT=5444 node scripts/dev-admin.mjs [port]
import { spawn } from "node:child_process";

const port = process.argv[2] ?? "3200";
const url = `postgresql://postgres:postgres@127.0.0.1:${process.env.PGLITE_PORT ?? 5444}/postgres`;
const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "-p", port], {
  stdio: "inherit",
  env: {
    ...process.env,
    DATABASE_URL: `${url}?connection_limit=1&pgbouncer=true`,
    DIRECT_URL: url,
    NEXT_DIST_DIR: ".next-admin",
    STORAGE_DIR: process.env.STORAGE_DIR ?? "storage",
    SUPABASE_SERVICE_ROLE_KEY: "",
    // Pas de clé d'IA : aucun appel externe pendant les essais.
    GEMINI_API_KEY: "",
    OPENROUTER_API_KEY: "",
  },
});
child.on("exit", (code) => process.exit(code ?? 0));
