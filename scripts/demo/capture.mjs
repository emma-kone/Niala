// ─────────────────────────────────────────────────────────────────────────────
// Captures d'écran des modules pour la page d'accueil, prises sur le compte de DÉMONSTRATION d'une instance locale.
//   1. node scripts/dev-db.mjs (base locale)  2. npx tsx scripts/demo/seed-demo.ts  3. next dev -p 3100 sur cette base
//   4. DEMO_PASSWORD=<le même qu'à l'étape 2> node scripts/demo/capture.mjs [http://localhost:3100]   (nécessite puppeteer-core et Microsoft Edge ou Chrome)
// Les images sont écrites dans public/accueil/.
// ─────────────────────────────────────────────────────────────────────────────
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import puppeteer from "puppeteer-core";

const BASE = process.argv[2] ?? "http://localhost:3100";
const DEMO_PASSWORD = process.env.DEMO_PASSWORD ?? "";
if (!DEMO_PASSWORD) {
  console.error("Définissez DEMO_PASSWORD (le mot de passe donné à scripts/demo/seed-demo.ts).");
  process.exit(1);
}
const OUT = path.join(process.cwd(), "public", "accueil");
const ID = JSON.parse(process.env.DEMO_IDS ?? "{}");
const BROWSERS = [process.env.BROWSER_PATH, "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "C:/Program Files/Google/Chrome/Application/chrome.exe", "/opt/pw-browsers/chromium", "/usr/bin/chromium"].filter(Boolean);
const executablePath = BROWSERS.find((p) => existsSync(p));
if (!executablePath) throw new Error("Aucun navigateur trouvé (BROWSER_PATH).");
mkdirSync(OUT, { recursive: true });

const subject = (name) => ID.s?.find((s) => s.name === name)?.id;
const PAGES = [
  ["tableau-de-bord", "/"],
  ["matieres", "/matieres"],
  ["matiere", `/matieres/${subject("Algorithmique")}`],
  ["agenda", "/agenda"],
  ["exercices", "/exercices"],
  ["correction", ID.a?.[0] ? `/exercices/${ID.a[0].exerciseId}/tentatives/${ID.a[0].id}` : null],
  ["assistant", "/assistant"],
  ["carte-mentale", ID.m ? `/matieres/${ID.m.subjectId}/cartes/${ID.m.id}` : null],
  ["notes", "/notes"],
  ["progression", "/progression"],
  ["labo-code", "/code"],
].filter(([, p]) => p);

const browser = await puppeteer.launch({ executablePath, headless: true, args: ["--no-sandbox", "--lang=fr-FR"] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "light" }]);
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle2", timeout: 120_000 });
  const login = await page.evaluate(async (password) => {
    const r = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "demo@niala.local", password }) });
    return r.status;
  }, DEMO_PASSWORD);
  if (login !== 200) throw new Error(`Connexion du compte de démonstration impossible (${login}).`);
  // Visite guidée déjà vue : elle ne recouvre pas les captures.
  const me = await page.evaluate(async () => (await (await fetch("/api/auth/me")).json().catch(() => ({}))));
  const userId = me?.user?.id ?? ID.u;
  await page.evaluate((id) => {
    for (const k of [`niala:tour:student:v1:${id}`, "niala:tour:student:v1:anonyme"]) localStorage.setItem(k, "1");
    localStorage.setItem("theme", "light");
  }, userId);

  for (const [name, url] of PAGES) {
    await page.goto(`${BASE}${url}`, { waitUntil: "networkidle2", timeout: 120_000 });
    await new Promise((r) => setTimeout(r, 2500));
    // Badge de développement de Next.js masqué.
    await page.addStyleTag({ content: "nextjs-portal{display:none!important}" }).catch(() => undefined);
    // Assistant : ouvre la conversation de démonstration.
    if (name === "assistant") {
      await page.evaluate(() => [...document.querySelectorAll("button, a")].find((el) => el.textContent?.includes("Comprendre la récursivité"))?.click());
      await new Promise((r) => setTimeout(r, 2000));
    }
    // Pas de bannière ni de fenêtre résiduelle sur la capture.
    await page.keyboard.press("Escape").catch(() => undefined);
    await page.screenshot({ path: path.join(OUT, `${name}.webp`), type: "webp", quality: 82 });
    console.log("capture", name);
  }
} finally {
  await browser.close();
}
