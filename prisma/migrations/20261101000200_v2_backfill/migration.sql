-- StudyForge V2 — reprise des données V1 (idempotente, sans suppression).
--
-- • Les identifiants dérivés sont DÉTERMINISTES (préfixe + id V1) : relancer le script
--   ne crée aucun doublon (ON CONFLICT DO NOTHING / UPDATE conditionnels).
-- • Toute incohérence de comptage lève une exception : la migration est annulée.
-- • Non migré ici, volontairement (voir docs/V2-AUDIT-ET-PLAN.md §2.5) :
--     - ConceptStat : aucune matière n'y est enregistrée, un rattachement automatique
--       fusionnerait des notions de matières différentes. Reconstruit en phase 9 à partir
--       des tentatives (le snapshot conserve les notions et la matière).
--     - LegacyExercise / LegacyDocumentAnalysis : conservés en lecture seule ; les formats
--       V2 (questions typées, arbre de sections) ne sont pas déductibles sans perte.
--     - Le fichier original des documents V1 n'a jamais été stocké : originalMissing = true.

CREATE OR REPLACE FUNCTION pg_temp.safe_jsonb(t text) RETURNS jsonb AS $$
BEGIN
  RETURN t::jsonb;
EXCEPTION WHEN others THEN
  RETURN NULL;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- 1. Chapitres → dossiers racine (libres, déplaçables ensuite)
INSERT INTO "Folder" ("id", "userId", "subjectId", "parentId", "name", "createdAt", "updatedAt")
SELECT 'f_' || c."id", s."userId", c."subjectId", NULL, c."name", c."createdAt", c."createdAt"
FROM "Chapter" c
JOIN "Subject" s ON s."id" = c."subjectId"
ON CONFLICT ("id") DO NOTHING;

UPDATE "Document" d
SET "folderId" = 'f_' || d."chapterId"
WHERE d."chapterId" IS NOT NULL
  AND d."folderId" IS NULL
  AND EXISTS (SELECT 1 FROM "Folder" f WHERE f."id" = 'f_' || d."chapterId");

-- 2. Chaque document → version n°1 (original absent)
INSERT INTO "DocumentVersion"
  ("id", "userId", "documentId", "number", "storageKey", "originalMissing", "mime", "size",
   "pageCount", "extractStatus", "extractError", "createdAt")
SELECT
  'v_' || d."id", d."userId", d."id", 1, NULL, TRUE,
  CASE d."type"
    WHEN 'pdf'  THEN 'application/pdf'
    WHEN 'docx' THEN 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    WHEN 'pptx' THEN 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
    WHEN 'md'   THEN 'text/markdown'
    ELSE 'text/plain'
  END,
  d."size", d."pageCount",
  CASE d."status"
    WHEN 'READY' THEN 'READY'::"ExtractStatus"
    WHEN 'ERROR' THEN 'FAILED'::"ExtractStatus"
    WHEN 'PROCESSING' THEN 'PROCESSING'::"ExtractStatus"
    ELSE 'PENDING'::"ExtractStatus"
  END,
  d."error", d."createdAt"
FROM "Document" d
ON CONFLICT ("id") DO NOTHING;

UPDATE "Document" SET "currentVersionId" = 'v_' || "id"
WHERE "currentVersionId" IS NULL
  AND EXISTS (SELECT 1 FROM "DocumentVersion" v WHERE v."id" = 'v_' || "Document"."id");

-- 3. Extraits indexés → chunks de la version (page déduite de « Page N » / « Diapositive N »)
INSERT INTO "DocumentChunk" ("id", "userId", "versionId", "idx", "page", "charStart", "charEnd", "content", "words")
SELECT
  'k_' || lc."id", d."userId", 'v_' || d."id", lc."idx",
  CASE WHEN lc."section" ~ '^(Page|Diapositive) [0-9]+$'
       THEN substring(lc."section" from '[0-9]+')::int END,
  0, 0, lc."content", lc."words"
FROM "LegacyDocumentChunk" lc
JOIN "Document" d ON d."id" = lc."documentId"
ON CONFLICT ("id") DO NOTHING;

-- 4. Sessions V1 → tentatives (le snapshot conserve les questions V1 telles quelles)
INSERT INTO "ExerciseAttempt"
  ("id", "userId", "exerciseId", "snapshot", "status", "startedAt", "updatedAt", "finishedAt",
   "lastPosition", "durationSec", "score", "maxScore")
SELECT
  'a_' || s."id", s."userId", NULL,
  jsonb_build_object(
    'format', 'v1-session',
    'title', s."title",
    'mode', s."mode",
    'subjectId', s."subjectId",
    'config', pg_temp.safe_jsonb(s."config"),
    'questions', COALESCE(pg_temp.safe_jsonb(s."questions"), '[]'::jsonb)
  ),
  CASE s."status"
    WHEN 'GRADED' THEN 'GRADED'::"AttemptStatus"
    WHEN 'SUBMITTED' THEN 'SUBMITTED'::"AttemptStatus"
    ELSE 'IN_PROGRESS'::"AttemptStatus"
  END,
  s."startedAt", COALESCE(s."finishedAt", s."startedAt"), s."finishedAt",
  0, s."durationSec", s."score", s."maxScore"
FROM "Session" s
ON CONFLICT ("id") DO NOTHING;

-- 5. Dernière réponse de chaque question → Answer
INSERT INTO "Answer"
  ("id", "userId", "attemptId", "position", "value", "feedback", "verdict", "points",
   "gradedBy", "tries", "createdAt", "updatedAt")
SELECT DISTINCT ON (si."id")
  'r_' || si."id", s."userId", 'a_' || s."id", si."questionIdx",
  COALESCE(pg_temp.safe_jsonb(la."value"), 'null'::jsonb),
  pg_temp.safe_jsonb(la."feedback"),
  CASE si."status"
    WHEN 'CORRECT' THEN 'correct' WHEN 'PARTIAL' THEN 'partial'
    WHEN 'INCORRECT' THEN 'incorrect' WHEN 'SKIPPED' THEN 'skipped' ELSE NULL END,
  si."points",
  CASE la."gradedBy" WHEN 'rule' THEN 'RULE'::"GradedBy" WHEN 'ai' THEN 'AI'::"GradedBy"
       WHEN 'mixed' THEN 'MIXED'::"GradedBy" ELSE NULL END,
  la."attempts", la."createdAt", la."createdAt"
FROM "LegacyAnswer" la
JOIN "SessionItem" si ON si."id" = la."itemId"
JOIN "Session" s ON s."id" = si."sessionId"
ORDER BY si."id", la."createdAt" DESC
ON CONFLICT ("id") DO NOTHING;

-- 6. Contrôles d'intégrité : toute différence annule la migration
DO $$
DECLARE
  n_chapters int; n_folders int;
  n_docs int; n_versions int;
  n_lchunks int; n_chunks int;
  n_sessions int; n_attempts int;
  n_orphans int;
BEGIN
  SELECT count(*) INTO n_chapters FROM "Chapter" c JOIN "Subject" s ON s."id" = c."subjectId";
  SELECT count(*) INTO n_folders  FROM "Folder"   WHERE "id" LIKE 'f\_%';
  IF n_chapters <> n_folders THEN
    RAISE EXCEPTION 'Reprise V2 : % chapitres mais % dossiers', n_chapters, n_folders;
  END IF;

  SELECT count(*) INTO n_docs     FROM "Document";
  SELECT count(*) INTO n_versions FROM "DocumentVersion" WHERE "id" LIKE 'v\_%';
  IF n_docs <> n_versions THEN
    RAISE EXCEPTION 'Reprise V2 : % documents mais % versions', n_docs, n_versions;
  END IF;

  SELECT count(*) INTO n_lchunks FROM "LegacyDocumentChunk";
  SELECT count(*) INTO n_chunks  FROM "DocumentChunk" WHERE "id" LIKE 'k\_%';
  IF n_lchunks <> n_chunks THEN
    RAISE EXCEPTION 'Reprise V2 : % extraits V1 mais % chunks', n_lchunks, n_chunks;
  END IF;

  SELECT count(*) INTO n_sessions FROM "Session";
  SELECT count(*) INTO n_attempts FROM "ExerciseAttempt" WHERE "id" LIKE 'a\_%';
  IF n_sessions <> n_attempts THEN
    RAISE EXCEPTION 'Reprise V2 : % sessions mais % tentatives', n_sessions, n_attempts;
  END IF;

  -- Isolation : un dossier / une version doit appartenir au même utilisateur que sa matière / son document
  SELECT count(*) INTO n_orphans FROM "Folder" f JOIN "Subject" s ON s."id" = f."subjectId" WHERE s."userId" <> f."userId";
  IF n_orphans > 0 THEN RAISE EXCEPTION 'Reprise V2 : % dossiers rattachés à la matière d''un autre utilisateur', n_orphans; END IF;
  SELECT count(*) INTO n_orphans FROM "DocumentVersion" v JOIN "Document" d ON d."id" = v."documentId" WHERE d."userId" <> v."userId";
  IF n_orphans > 0 THEN RAISE EXCEPTION 'Reprise V2 : % versions rattachées au document d''un autre utilisateur', n_orphans; END IF;
END $$;
