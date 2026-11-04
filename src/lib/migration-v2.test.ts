// Joue les vraies migrations SQL (baseline V1 → fondation V2 → reprise) sur un
// Postgres en mémoire (PGlite) alimenté de données V1 réalistes.
import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";

const dir = path.join(process.cwd(), "prisma", "migrations");
const sql = (name: string) => readFileSync(path.join(dir, name, "migration.sql"), "utf8");

let pg: PGlite;
const one = async <T = Record<string, unknown>>(q: string) => (await pg.query<T>(q)).rows;
const count = async (q: string) => Number((await one<{ n: number }>(`SELECT count(*)::int AS n FROM ${q}`))[0].n);

beforeAll(async () => {
  pg = new PGlite();
  await pg.exec(sql("20261101000000_v1_baseline"));

  // ── Données V1 : deux utilisateurs pour vérifier l'isolation ──
  await pg.exec(`
    INSERT INTO "User" (id,email,"passwordHash","updatedAt") VALUES ('u1','a@x.fr','h',now()),('u2','b@x.fr','h',now());
    INSERT INTO "Subject" (id,"userId",name,"updatedAt") VALUES ('s1','u1','Algo',now()),('s2','u2','Réseaux',now());
    INSERT INTO "Chapter" (id,"subjectId",name) VALUES ('c1','s1','Chapitre 1'),('c2','s1','Chapitre 1'),('c3','s2','Intro');
    INSERT INTO "Document" (id,"userId","subjectId","chapterId",name,"originalName",type,size,status,"extractedText","pageCount","updatedAt")
      VALUES ('d1','u1','s1','c1','Cours','cours.pdf','pdf',1000,'READY','texte',3,now()),
             ('d2','u1','s1',NULL,'Orphelin','o.docx','docx',500,'ERROR',NULL,NULL,now()),
             ('d3','u2','s2','c3','Autre','a.md','md',50,'READY','x',NULL,now());
    INSERT INTO "DocumentChunk" (id,"documentId",idx,section,content,words)
      VALUES ('k1','d1',0,'Page 1','Les fonctions...',2),('k2','d1',1,'Page 2','Les paramètres...',2),('k3','d1',2,NULL,'Fin',1),('k4','d3',0,NULL,'Autre',1);
    INSERT INTO "DocumentAnalysis" (id,"documentId",summary) VALUES ('an1','d1','résumé');
    INSERT INTO "Exercise" (id,"userId","subjectId",title,config,questions) VALUES ('e1','u1','s1','Ex','{}','[]');
    INSERT INTO "Session" (id,"userId","subjectId",status,questions,config,score,"maxScore")
      VALUES ('ses1','u1','s1','GRADED','[{"type":"qcm_single","statement":"Q?","notions":["fonctions"],"points":1}]','{"documentIds":["d1"]}',1,1),
             ('ses2','u1','s1','IN_PROGRESS','NOT JSON',NULL,NULL,NULL);
    INSERT INTO "SessionItem" (id,"sessionId","exerciseId","questionIdx","maxPoints",points,status,graded)
      VALUES ('it1','ses1','e1',0,1,1,'CORRECT',true);
    INSERT INTO "Answer" (id,"itemId",value,feedback,"gradedBy",attempts,"createdAt")
      VALUES ('ans0','it1','"vieux"',NULL,'rule',1,now() - interval '1 hour'),
             ('ans1','it1','"a"','{"verdict":"correct"}','rule',2,now());
  `);

  await pg.exec(sql("20261101000100_v2_foundation"));
  await pg.exec(sql("20261101000200_v2_backfill"));
  await pg.exec(sql("20261101000300_v2_rls"));
  await pg.exec(sql("20261104000000_niala_theme_default"));
  await pg.exec(sql("20261104000100_niala_chat"));
  await pg.exec(sql("20261105000000_niala_diagnosis"));
  await pg.exec(sql("20261106000000_niala_progression"));
});

describe("migration V1 → V2", () => {
  it("conserve toutes les données V1 dans les tables Legacy*", async () => {
    expect(await count(`"LegacyDocumentChunk"`)).toBe(4);
    expect(await count(`"LegacyDocumentAnalysis"`)).toBe(1);
    expect(await count(`"LegacyExercise"`)).toBe(1);
    expect(await count(`"LegacyAnswer"`)).toBe(2);
    expect(await count(`"Session"`)).toBe(2);
    expect(await count(`"Chapter"`)).toBe(3);
  });

  it("transforme les chapitres en dossiers racine et range les documents", async () => {
    expect(await count(`"Folder"`)).toBe(3);
    const d1 = (await one<{ folderId: string }>(`SELECT "folderId" FROM "Document" WHERE id='d1'`))[0];
    expect(d1.folderId).toBe("f_c1");
    const orphan = (await one<{ folderId: string | null }>(`SELECT "folderId" FROM "Document" WHERE id='d2'`))[0];
    expect(orphan.folderId).toBeNull();
    // Deux chapitres homonymes dans une matière restent deux dossiers distincts
    expect(await count(`"Folder" WHERE "subjectId"='s1' AND name='Chapitre 1'`)).toBe(2);
  });

  it("crée une version par document, marquée sans original", async () => {
    expect(await count(`"DocumentVersion"`)).toBe(3);
    const v = (await one<Record<string, unknown>>(`SELECT * FROM "DocumentVersion" WHERE "documentId"='d1'`))[0];
    expect(v.originalMissing).toBe(true);
    expect(v.storageKey).toBeNull();
    expect(v.mime).toBe("application/pdf");
    expect(v.extractStatus).toBe("READY");
    expect((await one<{ s: string }>(`SELECT "extractStatus" AS s FROM "DocumentVersion" WHERE "documentId"='d2'`))[0].s).toBe("FAILED");
    const cur = (await one<{ c: string }>(`SELECT "currentVersionId" AS c FROM "Document" WHERE id='d1'`))[0];
    expect(cur.c).toBe("v_d1");
  });

  it("reporte les extraits avec leur numéro de page", async () => {
    const rows = await one<{ idx: number; page: number | null }>(`SELECT idx, page FROM "DocumentChunk" WHERE "versionId"='v_d1' ORDER BY idx`);
    expect(rows.map((r) => r.page)).toEqual([1, 2, null]);
  });

  it("transforme les sessions en tentatives avec la dernière réponse", async () => {
    expect(await count(`"ExerciseAttempt"`)).toBe(2);
    const a = (await one<{ snapshot: { format: string; questions: unknown[] }; status: string }>(`SELECT snapshot, status FROM "ExerciseAttempt" WHERE id='a_ses1'`))[0];
    expect(a.status).toBe("GRADED");
    expect(a.snapshot.format).toBe("v1-session");
    expect(a.snapshot.questions).toHaveLength(1);
    // Snapshot invalide en V1 → tableau vide, pas d'échec de migration
    const bad = (await one<{ snapshot: { questions: unknown[] } }>(`SELECT snapshot FROM "ExerciseAttempt" WHERE id='a_ses2'`))[0];
    expect(bad.snapshot.questions).toEqual([]);
    const ans = await one<{ value: string; verdict: string; tries: number; gradedBy: string }>(`SELECT value, verdict, tries, "gradedBy" FROM "Answer"`);
    expect(ans).toHaveLength(1);
    expect(ans[0]).toMatchObject({ value: "a", verdict: "correct", tries: 2, gradedBy: "RULE" });
  });

  it("active la RLS sur les nouvelles tables", async () => {
    const off = await one<{ relname: string }>(`SELECT relname FROM pg_class WHERE relkind='r' AND relnamespace='public'::regnamespace AND NOT relrowsecurity AND (relname LIKE 'Legacy%' OR relname IN ('Folder','DocumentVersion','DocumentChunk','DocumentAnalysis','CourseSection','Concept','ConceptSource','ConceptRelation','Note','NoteLink','MindMap','MindMapNode','MindMapEdge','MindMapRevision','Exercise','Question','QuestionConcept','ExerciseAttempt','Answer','ErrorDiagnosis','ConceptMastery','LearningActivity','LearningRecommendation','LabWorkspace','LabRun'))`);
    expect(off.map((r) => r.relname)).toEqual([]);
  });

  it("respecte l'isolation entre utilisateurs", async () => {
    const leaks = await count(`"Folder" f JOIN "Subject" s ON s.id=f."subjectId" WHERE s."userId" <> f."userId"`);
    expect(leaks).toBe(0);
    expect(await count(`"DocumentChunk" k JOIN "DocumentVersion" v ON v.id=k."versionId" WHERE v."userId" <> k."userId"`)).toBe(0);
  });

  it("est idempotente : rejouer la reprise ne duplique rien", async () => {
    const before = [await count(`"Folder"`), await count(`"DocumentVersion"`), await count(`"DocumentChunk"`), await count(`"ExerciseAttempt"`), await count(`"Answer"`)];
    await pg.exec(sql("20261101000200_v2_backfill"));
    const after = [await count(`"Folder"`), await count(`"DocumentVersion"`), await count(`"DocumentChunk"`), await count(`"ExerciseAttempt"`), await count(`"Answer"`)];
    expect(after).toEqual(before);
  });

  it("empêche de créer deux versions identiques et valide les contraintes", async () => {
    await expect(
      pg.exec(`INSERT INTO "DocumentVersion" (id,"userId","documentId",number,mime,size) VALUES ('vx','u1','d1',1,'a',1)`)
    ).rejects.toThrow();
    // Un dossier ne peut pas référencer une matière inexistante
    await expect(
      pg.exec(`INSERT INTO "Folder" (id,"userId","subjectId",name,"updatedAt") VALUES ('fx','u1','nope','x',now())`)
    ).rejects.toThrow();
  });
});
