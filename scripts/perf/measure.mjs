// Chronomètre les routes d'API surveillées par le back-office, sur le banc de mesure (scripts/perf/serve.mjs).
//   DEMO_PASSWORD=… node scripts/perf/measure.mjs [latenceMs=80] [répétitions=8] [base=http://localhost:3300]
// Pour chaque route : moyenne, p95, maximum et nombre d'allers-retours base par appel. Puis une rafale « ouverture de page »
// (toutes les lectures lancées ensemble, comme le fait le navigateur), qui révèle l'attente sur le groupe de connexions.
// Reste très en dessous du plafond anti-inondation du proxy (400 requêtes / 10 s) et envoie l'en-tête Origin du site.
const rtt = Number(process.argv[2] ?? 80);
const runs = Number(process.argv[3] ?? 8);
const base = process.argv[4] ?? "http://localhost:3300";
const control = "http://127.0.0.1:5455";
const email = process.env.DEMO_EMAIL ?? "demo@niala.local";
const password = process.env.DEMO_PASSWORD ?? "";
if (!password) throw new Error("Définissez DEMO_PASSWORD (compte de démonstration de la base de mesure).");

const ctl = (p) => fetch(control + p).then((r) => r.json());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let cookie = "";
const call = async (method, path, body) => {
  const t = performance.now();
  const res = await fetch(base + path, { method, headers: { origin: base, cookie, ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  return { ms: performance.now() - t, status: res.status, res, json: (() => { try { return JSON.parse(text); } catch { return null; } })() };
};
const p = (xs, q) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.ceil(q * xs.length) - 1)];

await ctl(`/set?ms=${rtt}`);
const login = await call("POST", "/api/auth/login", { email, password });
if (login.status !== 200) throw new Error(`Connexion refusée (${login.status}).`);
cookie = login.res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");

const today = new Date().toISOString().slice(0, 10);
const plus = (n) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
const subjects = (await call("GET", "/api/subjects")).json?.subjects ?? [];
const prog = (await call("GET", "/api/progress")).json ?? {};
const sid = subjects[0]?.id;
const cid = prog.concepts?.[0]?.id;
const aid = prog.attempts?.[0]?.id;

const routes = [
  ["GET", `/api/dashboard?date=${today}&minutes=600`],
  ["GET", "/api/agenda/imports"],
  ["GET", `/api/agenda?from=${plus(-3)}&to=${plus(4)}`],
  ["GET", "/api/settings"],
  ["GET", "/api/notifications"],
  ["GET", "/api/support/replies"],
  ["GET", "/api/support/requests"],
  ["GET", "/api/subjects"],
  ["GET", `/api/agenda/tasks?date=${today}&minutes=600`],
  sid && ["GET", `/api/subjects/${sid}/explorer`],
  aid && ["GET", `/api/attempts/${aid}/tutor`],
  ["GET", "/api/profile"],
  ["GET", "/api/progress"],
  cid && ["GET", `/api/progress/concepts/${cid}`],
  aid && ["GET", `/api/attempts/${aid}`],
  sid && ["GET", `/api/subjects/${sid}/maps`],
  ["GET", "/api/agenda/settings"],
  ["POST", "/api/auth/login", { email, password }],
].filter(Boolean);

const rows = [];
for (const [method, path, body] of routes) {
  await call(method, path, body); // premier appel : compilation de la route en développement, non compté
  await sleep(300); // laisse partir l'écriture du journal RequestLog de l'appel précédent
  const times = [];
  await ctl("/reset");
  let status = 0;
  for (let i = 0; i < runs; i++) {
    const r = await call(method, path, body);
    times.push(r.ms);
    status = r.status;
  }
  await sleep(300);
  const { roundTrips } = await ctl("/stats");
  rows.push({ route: `${method} ${path.replace(/\?.*/, "").replace(/\/[a-z0-9]{20,}/g, "/:id")}`, statut: status, "moy ms": Math.round(times.reduce((a, b) => a + b, 0) / runs), "p95 ms": Math.round(p(times, 0.95)), "max ms": Math.round(Math.max(...times)), "A/R base": Math.round((roundTrips / runs) * 10) / 10 });
}
console.log(`\nLatence base simulée : ${rtt} ms aller-retour — ${runs} appels par route (le journal RequestLog compte dans les A/R)`);
console.table(rows);

// Rafale : les lectures qu'une page lance ensemble à l'ouverture.
const burst = routes.filter(([m]) => m === "GET").slice(0, 9);
const bt = [];
for (let i = 0; i < 4; i++) {
  const t = performance.now();
  const rs = await Promise.all(burst.map(([m, path]) => call(m, path)));
  bt.push({ total: performance.now() - t, slowest: Math.max(...rs.map((r) => r.ms)) });
  await sleep(400);
}
console.log(`Rafale de ${burst.length} lectures simultanées : total moyen ${Math.round(bt.reduce((a, b) => a + b.total, 0) / bt.length)} ms, plus lente ${Math.round(Math.max(...bt.map((b) => b.slowest)))} ms`);
