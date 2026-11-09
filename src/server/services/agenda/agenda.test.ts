// Tests d'intégration de l'agenda : vrai Prisma sur PGlite (migrations réelles), faux fournisseur IA déterministe.
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import JSZip from "jszip";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import type { AiProvider, CompletionRequest } from "@/server/ai/provider";

let server: PGLiteSocketServer;
let pg: PGlite;
let dir: string;
let db: typeof import("@/lib/db").db;
let agenda: typeof import("./agenda");
let imports: typeof import("./import");
// Chargés après la redirection de la base : ces modules importent indirectement le client Prisma.
let extractCsv: typeof import("./extract").extractCsv;
let extractDocx: typeof import("./extract").extractDocx;
let extractXlsx: typeof import("./extract").extractXlsx;
let identifyFile: typeof import("./extract").identifyFile;
let normalizeDraft: typeof import("./interpret").normalizeDraft;
let prov: typeof import("@/server/ai/provider");
let A: string;
let B: string;
let subjectA: string;
let subjectB: string;

const MONDAY = "2026-11-09";
let aiResult: unknown = { cours: [] };
const received: CompletionRequest[] = [];
const fake: AiProvider = {
  name: "fake",
  model: "fake-1",
  async complete(req) {
    received.push(req);
    return { text: JSON.stringify(aiResult), model: "fake-1" };
  },
};

const course = (over = {}) => ({ matiere: "Algorithmique", jour: 1, debut: "08:00", fin: "09:30", salle: "A1", enseignant: null, semaine: "ALL" as "ALL" | "A" | "B", recurrent: true, confiance: "elevee" as "elevee" | "moyenne" | "faible", ...over });
const input = (over = {}) => agenda.createEventSchema.parse({ title: "Cours", date: MONDAY, startMinutes: 480, endMinutes: 570, ...over });
const csv = (text: string) => new File([text], "edt.csv", { type: "text/csv" });
const week = (user: string, from = MONDAY) => agenda.occurrencesBetween(user, from, new Date(Date.parse(`${from}T00:00:00Z`) + 6 * 86_400_000).toISOString().slice(0, 10)).then((r) => r.occurrences);
const patch = (over: Record<string, unknown>) => agenda.patchEventSchema.parse({ scope: "all", occurrenceDate: MONDAY, ...over });

beforeAll(async () => {
  pg = await PGlite.create();
  const dirMig = path.join(process.cwd(), "prisma", "migrations");
  for (const name of ["20261101000000_v1_baseline", "20261101000100_v2_foundation", "20261101000200_v2_backfill", "20261104000000_niala_theme_default", "20261104000100_niala_chat", "20261109000000_niala_reliability", "20261110000000_niala_agenda", "20261111000000_niala_academic", "20261112000000_niala_subject_icon", "20261113000000_niala_google_link"]) await pg.exec(readFileSync(path.join(dirMig, name, "migration.sql"), "utf8"));
  const port = 30000 + Math.floor(Math.random() * 10000);
  server = new PGLiteSocketServer({ db: pg, port, host: "127.0.0.1", maxConnections: 4 });
  await server.start();
  dir = mkdtempSync(path.join(tmpdir(), "niala-agenda-"));
  process.env.DATABASE_URL = `postgresql://postgres:postgres@127.0.0.1:${port}/postgres?connection_limit=1&pgbouncer=true`;
  process.env.DIRECT_URL = process.env.DATABASE_URL;
  process.env.STORAGE_DIR = dir;
  process.env.SUPABASE_SERVICE_ROLE_KEY = "";
  db = (await import("@/lib/db")).db;
  agenda = await import("./agenda");
  imports = await import("./import");
  ({ extractCsv, extractDocx, extractXlsx, identifyFile } = await import("./extract"));
  ({ normalizeDraft } = await import("./interpret"));
  prov = await import("@/server/ai/provider");
  prov.__setProviderForTests(fake);
  A = (await db.user.create({ data: { email: "a@x.fr", passwordHash: "x" } })).id;
  B = (await db.user.create({ data: { email: "b@x.fr", passwordHash: "x" } })).id;
  subjectA = (await db.subject.create({ data: { userId: A, name: "Algorithmique" } })).id;
  subjectB = (await db.subject.create({ data: { userId: B, name: "Réseaux" } })).id;
}, 90_000);

afterAll(async () => {
  prov?.__setProviderForTests(undefined);
  await db?.$disconnect();
  await server?.stop();
  await pg?.close();
  rmSync(dir, { recursive: true, force: true });
});

async function clean() {
  await db.scheduleEvent.deleteMany();
  await db.scheduleBreak.deleteMany();
  await db.scheduleImport.deleteMany();
}

describe("cours", () => {
  it("accepte toutes les durées et reste privé", async () => {
    await clean();
    for (const [s, e] of [[450, 480], [510, 555], [615, 705], [840, 960]]) await agenda.createEvent(A, input({ startMinutes: s, endMinutes: e }));
    expect(await week(A)).toHaveLength(4);
    expect(await week(B)).toHaveLength(0);
  });

  it("refuse un chevauchement involontaire, l'accepte sur confirmation", async () => {
    await clean();
    await agenda.createEvent(A, input());
    await expect(agenda.createEvent(A, input({ startMinutes: 540, endMinutes: 590 }))).rejects.toMatchObject({ status: 409 });
    await agenda.createEvent(A, input({ startMinutes: 540, endMinutes: 590, force: true }));
    expect(await week(A)).toHaveLength(2);
  });

  it("deux cours qui se suivent passent sans alerte", async () => {
    await clean();
    await agenda.createEvent(A, input());
    await agenda.createEvent(A, input({ startMinutes: 570, endMinutes: 600 }));
    expect(await week(A)).toHaveLength(2);
  });

  it("n'impose aucune pause, protège celles de l'étudiant sauf confirmation", async () => {
    await clean();
    await agenda.createEvent(A, input({ startMinutes: 750, endMinutes: 810 }));
    await db.scheduleBreak.create({ data: { userId: A, label: "Sieste", startMinutes: 590, endMinutes: 620 } });
    await expect(agenda.createEvent(A, input({ startMinutes: 600, endMinutes: 650 }))).rejects.toMatchObject({ status: 409 });
    await agenda.createEvent(A, input({ startMinutes: 600, endMinutes: 650, force: true }));
    expect(await week(A)).toHaveLength(2);
  });

  it("accepte tout horaire réel, refuse une matière d'un autre compte", async () => {
    await clean();
    await agenda.createEvent(A, input({ startMinutes: 400, endMinutes: 470 }));
    await expect(agenda.createEvent(A, input({ subjectId: subjectB }))).rejects.toMatchObject({ status: 404 });
  });

  it("un autre compte ne peut ni modifier ni supprimer", async () => {
    await clean();
    const e = await agenda.createEvent(A, input());
    await expect(agenda.updateEvent(B, e.id, patch({ startMinutes: 510, endMinutes: 570 }))).rejects.toMatchObject({ status: 404 });
    await expect(agenda.deleteEvent(B, e.id, "all", null)).rejects.toMatchObject({ status: 404 });
  });

  it("déplace un cours vers un autre jour et d'autres heures", async () => {
    await clean();
    const e = await agenda.createEvent(A, input());
    await agenda.updateEvent(A, e.id, patch({ date: "2026-11-11", startMinutes: 900, endMinutes: 990 }));
    expect((await week(A)).map((o) => [o.date, o.startMinutes])).toEqual([["2026-11-11", 900]]);
  });
});

describe("séries", () => {
  const weekly = (over = {}) => agenda.createEvent(A, input({ recurrence: "WEEKLY", ...over }));

  it("modifie une séance sans changer les autres", async () => {
    await clean();
    const e = await weekly();
    await agenda.updateEvent(A, e.id, patch({ scope: "occurrence", occurrenceDate: "2026-11-16", startMinutes: 900, endMinutes: 960, room: "B2" }));
    expect((await week(A, "2026-11-16"))[0]).toMatchObject({ startMinutes: 900, room: "B2", overridden: true });
    expect((await week(A, "2026-11-23"))[0]).toMatchObject({ startMinutes: 480, room: null });
  });

  it("modifie toute la série et décale ses séances modifiées", async () => {
    await clean();
    const e = await weekly();
    await agenda.updateEvent(A, e.id, patch({ scope: "occurrence", occurrenceDate: "2026-11-16", room: "B2" }));
    await agenda.updateEvent(A, e.id, patch({ date: "2026-11-10", startMinutes: 510, endMinutes: 600 }));
    expect((await week(A)).map((o) => [o.date, o.startMinutes])).toEqual([["2026-11-10", 510]]);
    expect((await week(A, "2026-11-16"))[0]).toMatchObject({ date: "2026-11-17", room: "B2" });
  });

  it("supprime une séance, puis la série", async () => {
    await clean();
    const e = await weekly();
    await agenda.deleteEvent(A, e.id, "occurrence", "2026-11-16");
    expect(await week(A, "2026-11-16")).toHaveLength(0);
    expect(await week(A, "2026-11-23")).toHaveLength(1);
    await agenda.deleteEvent(A, e.id, "all", null);
    expect(await week(A, "2026-11-23")).toHaveLength(0);
  });

  it("détecte un conflit qui n'apparaît qu'une semaine plus tard", async () => {
    await clean();
    await agenda.createEvent(A, input({ date: "2026-11-23" }));
    await expect(weekly()).rejects.toMatchObject({ status: 409 });
  });

  it("n'oppose pas deux cours en semaines A et B", async () => {
    await clean();
    await weekly({ weekPattern: "A" });
    await weekly({ weekPattern: "B" });
    expect(await week(A)).toHaveLength(1);
  });
});

describe("formats", () => {
  const zipped = async (files: Record<string, string>) => {
    const z = new JSZip();
    for (const [n, c] of Object.entries(files)) z.file(n, c);
    return Buffer.from(await z.generateAsync({ type: "nodebuffer" }));
  };

  it("CSV : UTF-8, BOM et Latin-1", () => {
    expect(extractCsv(Buffer.from("﻿Lundi;Maths"))).toMatchObject({ text: "Lundi;Maths" });
    expect(extractCsv(Buffer.from("Français", "latin1"))).toMatchObject({ text: "Français" });
  });

  it("XLSX : textes partagés, heures Excel et cellules fusionnées", async () => {
    const out = await extractXlsx(await zipped({
      "xl/sharedStrings.xml": "<sst><si><t>Lundi</t></si><si><t>Maths &amp; co</t></si></sst>",
      "xl/worksheets/sheet1.xml": '<worksheet><sheetData><row><c r="A1" t="s"><v>0</v></c><c r="B1"><v>0.3125</v></c></row><row><c r="A2" t="s"><v>1</v></c></row></sheetData><mergeCells><mergeCell ref="A2:B2"/></mergeCells></worksheet>',
    }));
    expect(out).toMatchObject({ kind: "text", text: "Lundi | 07:30\nMaths & co | Maths & co" });
  });

  it("DOCX : conserve la structure des tableaux", async () => {
    const body = "<w:tbl><w:tr><w:tc><w:p><w:r><w:t>Lundi</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Physique</w:t></w:r></w:p></w:tc></w:tr></w:tbl>";
    const out = await extractDocx(await zipped({
      "[Content_Types].xml": '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
      "_rels/.rels": '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="r1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
      "word/document.xml": `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`,
    }));
    expect(out).toMatchObject({ kind: "text" });
    expect((out as { text: string }).text).toContain("Lundi | Physique");
  });

  it("refuse un contenu qui ne correspond pas à l'extension, un .xls et un format inconnu", () => {
    expect(() => identifyFile("edt.pdf", Buffer.from("pas un pdf"))).toThrow(/ne correspond pas/);
    expect(() => identifyFile("edt.xls", Buffer.from([0xd0, 0xcf]))).toThrow(/xlsx/);
    expect(() => identifyFile("edt.exe", Buffer.from("MZ"))).toThrow(/non pris en charge/);
    expect(() => identifyFile("edt.csv", Buffer.alloc(0))).toThrow(/vide/);
  });

  it("refuse un fichier trop volumineux", () => {
    expect(() => identifyFile("edt.csv", Buffer.alloc(10 * 1024 * 1024 + 1, 65))).toThrow(/volumineux/);
  });

  it("transmet un PDF au modèle comme fichier joint", async () => {
    await clean();
    received.length = 0;
    aiResult = { cours: [course()] };
    await imports.startImport(A, new File([Buffer.from("%PDF-1.4 x")], "edt.pdf", { type: "application/pdf" }));
    expect(received[0].attachment?.mime).toBe("application/pdf");
  });
});

describe("contrôle de l'extraction", () => {
  const normalize = (c: object, text: string | null = null) => normalizeDraft({ cours: [c] }, [{ id: "s1", name: "Algorithmique" }], text)[0];

  it("garde vide ce qui manque, et le signale", () => {
    const d = normalize({ matiere: "Maths", jour: null, debut: null, fin: "10:00", confiance: "elevee" });
    expect(d).toMatchObject({ day: null, startMinutes: null, room: null, teacher: null, confidence: "faible" });
    expect(d.issues).toEqual(expect.arrayContaining(["Jour non identifié.", "Heure de début manquante."]));
  });
  it("associe une matière existante", () => {
    expect(normalize(course({ matiere: "ALGORITHMIQUE" })).subjectId).toBe("s1");
  });
  it("marque incertain un nom absent du document", () => {
    const d = normalize(course({ matiere: "Astrophysique" }), "Lundi Maths 8h");
    expect(d.confidence).toBe("faible");
    expect(d.issues.join(" ")).toContain("retrouvé");
  });
  it("ne juge pas un horaire inhabituel, signale une pause du document et un horaire impossible", () => {
    expect(normalize(course({ debut: "06:00", fin: "07:00" })).issues).toEqual([]);
    expect(normalizeDraft({ cours: [course({ debut: "11:30", fin: "12:30" })] }, [], null, [{ label: "Pause", startMinutes: 720, endMinutes: 750, weekday: null }])[0].issues).toContain("Empiète sur une pause.");
    expect(normalize(course({ debut: "10:00", fin: "09:00" })).issues.join(" ")).toContain("après");
  });
  it("signale un chevauchement dans le document, pas entre semaines A et B", () => {
    const pair = (a: "ALL" | "A" | "B", b: "ALL" | "A" | "B") => normalizeDraft({ cours: [course({ semaine: a }), course({ matiere: "Maths", semaine: b })] }, [], null)[0].issues;
    expect(pair("ALL", "ALL").join(" ")).toContain("Chevauche");
    expect(pair("A", "B").join(" ")).not.toContain("Chevauche");
  });
});

describe("import complet", () => {
  const confirmBody = (events: unknown[], mode: "add" | "replace" = "add") => imports.confirmSchema.parse({ mode, startDate: MONDAY, events });
  const validated = (r: Awaited<ReturnType<typeof imports.startImport>>) => r.events.map((e) => ({ ...e, day: e.day!, startMinutes: e.startMinutes!, endMinutes: e.endMinutes!, createSubject: !e.subjectId }));

  it("n'ajoute rien avant validation, puis enregistre avec la source", async () => {
    await clean();
    aiResult = { cours: [course(), course({ matiere: "Réseaux", jour: 2, debut: "14:00", fin: "16:00", salle: null })] };
    const r = await imports.startImport(A, csv("Lundi Algorithmique 8h; Mardi Réseaux 14h"));
    expect(await week(A)).toHaveLength(0);
    expect(r.events.map((e) => e.status)).toEqual(["nouveau", "nouveau"]);
    const done = await imports.confirmImport(A, r.id, confirmBody(validated(r)));
    expect(done).toMatchObject({ created: 2, subjectsCreated: 1 });
    const list = await week(A);
    expect(list.map((o) => [o.date, o.title, o.room])).toEqual([[MONDAY, "Algorithmique", "A1"], ["2026-11-10", "Réseaux", null]]);
    expect(list[0].subjectId).toBe(subjectA);
    expect(list[0].importId).toBe(r.id);
    await expect(imports.importFile(A, r.id)).resolves.toMatchObject({ fileName: "edt.csv" });
    await expect(imports.importFile(B, r.id)).rejects.toMatchObject({ status: 404 });
  });

  it("un second import identique ne crée aucun doublon", async () => {
    await clean();
    aiResult = { cours: [course()] };
    const first = await imports.startImport(A, csv("Lundi Algorithmique 8h"));
    await imports.confirmImport(A, first.id, confirmBody(validated(first)));
    const second = await imports.startImport(A, csv("Lundi Algorithmique 8h"));
    expect(second.events[0].status).toBe("identique");
    expect(await imports.confirmImport(A, second.id, confirmBody(validated(second)))).toMatchObject({ created: 0, skipped: 1 });
    expect(await week(A)).toHaveLength(1);
  });

  it("nouvelle version : compléter ne change rien, appliquer met à jour et retire", async () => {
    await clean();
    aiResult = { cours: [course(), course({ matiere: "Chimie", jour: 3 })] };
    const first = await imports.startImport(A, csv("Lundi Algorithmique Mercredi Chimie"));
    await imports.confirmImport(A, first.id, confirmBody(validated(first)));

    aiResult = { cours: [course({ debut: "09:00", fin: "10:00" })] };
    const add = await imports.startImport(A, csv("Lundi Algorithmique"));
    expect(add.events[0]).toMatchObject({ status: "modifie", changes: ["horaire"] });
    expect(add.removed.map((x) => x.title)).toEqual(["Chimie"]);
    await imports.confirmImport(A, add.id, confirmBody(validated(add), "add"));
    expect((await week(A)).map((o) => o.startMinutes)).toEqual([480, 480]);

    const replace = await imports.startImport(A, csv("Lundi Algorithmique"));
    expect(await imports.confirmImport(A, replace.id, confirmBody(validated(replace), "replace"))).toMatchObject({ updated: 1, removed: 1 });
    expect((await week(A)).map((o) => [o.title, o.startMinutes])).toEqual([["Algorithmique", 540]]);
  });

  it("garde un cours saisi à la main lors d'un remplacement", async () => {
    await clean();
    await agenda.createEvent(A, input({ title: "Sport", date: "2026-11-12", recurrence: "WEEKLY" }));
    aiResult = { cours: [course()] };
    const r = await imports.startImport(A, csv("Lundi Algorithmique"));
    await imports.confirmImport(A, r.id, confirmBody(validated(r), "replace"));
    expect((await week(A)).map((o) => o.title).sort()).toEqual(["Algorithmique", "Sport"]);
  });

  it("demande confirmation en cas de conflit avec l'agenda", async () => {
    await clean();
    await agenda.createEvent(A, input({ title: "Sport", date: MONDAY, recurrence: "WEEKLY" }));
    aiResult = { cours: [course()] };
    const r = await imports.startImport(A, csv("Lundi Algorithmique"));
    await expect(imports.confirmImport(A, r.id, confirmBody(validated(r)))).rejects.toMatchObject({ status: 409 });
    expect(await week(A)).toHaveLength(1);
  });

  it("un cours importé se modifie comme un cours manuel", async () => {
    await clean();
    aiResult = { cours: [course()] };
    const r = await imports.startImport(A, csv("Lundi Algorithmique"));
    await imports.confirmImport(A, r.id, confirmBody(validated(r)));
    const [o] = await week(A);
    await agenda.updateEvent(A, o.eventId, patch({ room: "C3" }));
    expect((await week(A))[0].room).toBe("C3");
  });

  it("un import annulé disparaît avec son fichier ; il est privé", async () => {
    await clean();
    aiResult = { cours: [course()] };
    const r = await imports.startImport(A, csv("Lundi Algorithmique"));
    await expect(imports.cancelImport(B, r.id)).rejects.toMatchObject({ status: 404 });
    await imports.cancelImport(A, r.id);
    expect(await db.scheduleImport.count()).toBe(0);
  });

  it("refuse une validation incomplète", async () => {
    expect(() => confirmBody([{ id: "d1", title: "X", day: null, startMinutes: 480, endMinutes: 540, weekPattern: "ALL", recurring: true }])).toThrow();
  });
});
