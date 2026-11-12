// Banc de mesure LOCAL des temps de réponse : base PGlite jetable + latence réseau simulée entre l'application et la base.
// Sert à chiffrer l'effet de la distance fonction ↔ base (ex. fonctions Vercel à Washington, base à Londres) et à compter
// les allers-retours base de chaque route. Aucune donnée Supabase n'est touchée.
//   node scripts/perf/serve.mjs [port=3300] [latenceAllerRetourMs=80] [postgresql://… d'un PostgreSQL LOCAL]
// Sans adresse, la base est PGlite : pratique (rien à installer), mais elle n'a qu'une session, donc des requêtes lancées
// ensemble y passent l'une après l'autre. Pour mesurer le gain des lectures parallèles, fournir un vrai PostgreSQL local
// (troisième argument ou PERF_DATABASE_URL), migrations appliquées ; toute adresse non locale est refusée.
// Pilotage pendant l'exécution (port 5455) : /set?ms=2 change la latence, /reset remet les compteurs à zéro, /stats les lit.
import { spawn } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";

// Quatrième argument facultatif : dossier de l'application à mesurer (par exemple une copie de travail git d'un autre
// commit, pour comparer avant / après sur la même base).
if (process.argv[5]) process.chdir(process.argv[5]);
const port = process.argv[2] ?? "3300";
let rttMs = Number(process.argv[3] ?? 80);
const external = process.argv[4] ?? process.env.PERF_DATABASE_URL ?? "";
if (external && !/@(127\.0\.0\.1|localhost):\d+\//.test(external)) {
  console.error("Refus : le banc de mesure ne se branche que sur une base locale (127.0.0.1 ou localhost).");
  process.exit(1);
}
const DB_PORT = external ? Number(new URL(external).port) : 5453;
const PROXY_PORT = 5454;
const CONTROL_PORT = 5455;

// ── Base jetable, avec toutes les migrations ─────────────────────────────────
if (!external) {
  const dir = path.join(process.cwd(), "prisma", "migrations");
  const db = await PGlite.create(process.env.PGLITE_DIR ?? ".pglite-perf");
  await db.exec(`CREATE TABLE IF NOT EXISTS _dev_migrations (name text PRIMARY KEY)`);
  const done = new Set((await db.query("SELECT name FROM _dev_migrations")).rows.map((r) => r.name));
  for (const name of readdirSync(dir).filter((n) => /^\d/.test(n)).sort()) {
    if (done.has(name)) continue;
    await db.exec(readFileSync(path.join(dir, name, "migration.sql"), "utf8"));
    await db.query("INSERT INTO _dev_migrations VALUES ($1)", [name]);
  }
  await new PGLiteSocketServer({ db, port: DB_PORT, host: "127.0.0.1", maxConnections: 16 }).start();
}

// ── Relais TCP qui retarde chaque sens de la moitié de la latence demandée ───
const stats = { roundTrips: 0, connections: 0 };
net
  .createServer((client) => {
    stats.connections++;
    const upstream = net.connect(DB_PORT, "127.0.0.1");
    let lastFromServer = true; // un envoi du client après une réponse du serveur = un nouvel aller-retour
    const relay = (from, to, isClient) => {
      let due = 0;
      from.on("data", (chunk) => {
        if (isClient && lastFromServer) stats.roundTrips++;
        lastFromServer = !isClient;
        // Sans latence demandée, écriture directe : les minuteries (≈ 15 ms de grain sous Windows) fausseraient la mesure.
        if (rttMs < 1 && due <= Date.now()) return void (to.writable && to.write(chunk));
        due = Math.max(Date.now() + rttMs / 2, due);
        setTimeout(() => to.writable && to.write(chunk), due - Date.now());
      });
      from.on("close", () => setTimeout(() => to.destroy(), rttMs / 2));
      from.on("error", () => to.destroy());
    };
    relay(client, upstream, true);
    relay(upstream, client, false);
  })
  .listen(PROXY_PORT, "127.0.0.1");

http
  .createServer((req, res) => {
    const u = new URL(req.url, "http://x");
    if (u.pathname === "/set") rttMs = Math.max(0, Number(u.searchParams.get("ms")) || 0);
    if (u.pathname === "/reset") stats.roundTrips = stats.connections = 0;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ rttMs, ...stats }));
  })
  .listen(CONTROL_PORT, "127.0.0.1");

// ── Application ──────────────────────────────────────────────────────────────
const direct = external || `postgresql://postgres:postgres@127.0.0.1:${DB_PORT}/postgres`;
const proxied = direct.replace(`:${DB_PORT}/`, `:${PROXY_PORT}/`).split("?")[0];
console.log(`Banc de mesure : application sur ${port}, latence base ${rttMs} ms aller-retour (pilotage : ${CONTROL_PORT}).`);
// Copie de travail dont node_modules est un lien vers celui du dépôt : Turbopack refuse les liens hors du dossier, webpack les suit.
const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "-p", port, ...(process.argv[5] ? ["--webpack"] : [])], {
  stdio: "inherit",
  env: {
    ...process.env,
    // Cinq connexions : la taille du groupe de connexions de Prisma sur une fonction à 2 processeurs (2 × 2 + 1).
    DATABASE_URL: `${proxied}?connection_limit=${process.env.PERF_POOL ?? 5}&pgbouncer=true`,
    DIRECT_URL: direct,
    NEXT_DIST_DIR: ".next-perf",
    STORAGE_DIR: process.env.STORAGE_DIR ?? "storage",
    SUPABASE_SERVICE_ROLE_KEY: "",
    // Pas de clé d'IA : aucun appel externe pendant les mesures.
    GEMINI_API_KEY: "",
    OPENROUTER_API_KEY: "",
  },
});
child.on("exit", (code) => process.exit(code ?? 0));
