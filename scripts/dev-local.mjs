// Lance Next.js contre la base PGlite locale (scripts/dev-db.mjs) et un stockage local :
// aucune donnée Supabase n'est touchée. Usage : node scripts/dev-local.mjs [port]
import { spawn } from "node:child_process";

const port = process.argv[2] ?? "3100";
const url = `postgresql://postgres:postgres@127.0.0.1:${process.env.PGLITE_PORT ?? 5433}/postgres`;
const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "-p", port], {
  stdio: "inherit",
  env: {
    ...process.env,
    DATABASE_URL: `${url}?connection_limit=1&pgbouncer=true`,
    DIRECT_URL: url,
    NEXT_DIST_DIR: ".next-local",
    STORAGE_DIR: process.env.STORAGE_DIR ?? "storage",
    SUPABASE_SERVICE_ROLE_KEY: "",
  },
});
child.on("exit", (code) => process.exit(code ?? 0));
