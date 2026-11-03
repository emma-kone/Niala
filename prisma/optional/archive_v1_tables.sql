-- OPTIONNEL — NON APPLIQUÉ, NON PRÉSENT dans prisma/migrations (donc jamais joué par `prisma migrate deploy`).
--
-- Archive les tables de la V1 dans un schéma séparé `archive_v1` (ALTER TABLE … SET SCHEMA) :
-- AUCUNE ligne n'est supprimée, l'opération est réversible (SET SCHEMA public), et les données
-- sortent de l'API REST publique Supabase. Les données non migrées vers la V2
-- (LegacyExercise, LegacyDocumentAnalysis, ConceptStat…) restent consultables en SQL.
--
-- À n'appliquer QU'APRÈS :
--   1. une sauvegarde de la base (snapshot / branche) ;
--   2. le nettoyage du code et de prisma/schema.prisma qui référencent encore ces tables
--      (voir docs/MIGRATION.md, « Archivage des tables V1 »), sinon l'application échouera ;
--   3. la vérification des contrôles ci-dessous.

DO $$
DECLARE n_sessions int; n_attempts int; n_chapters int; n_folders int;
BEGIN
  SELECT count(*) INTO n_sessions FROM "Session";
  SELECT count(*) INTO n_attempts FROM "ExerciseAttempt" WHERE "id" LIKE 'a\_%';
  SELECT count(*) INTO n_chapters FROM "Chapter";
  SELECT count(*) INTO n_folders FROM "Folder" WHERE "id" LIKE 'f\_%';
  IF n_sessions <> n_attempts THEN RAISE EXCEPTION 'Archivage annulé : % sessions V1 mais % tentatives migrées', n_sessions, n_attempts; END IF;
  IF n_chapters <> n_folders THEN RAISE EXCEPTION 'Archivage annulé : % chapitres V1 mais % dossiers migrés', n_chapters, n_folders; END IF;
END $$;

CREATE SCHEMA IF NOT EXISTS archive_v1;
ALTER TABLE "SessionItem" SET SCHEMA archive_v1;
ALTER TABLE "Session" SET SCHEMA archive_v1;
ALTER TABLE "LegacyAnswer" SET SCHEMA archive_v1;
ALTER TABLE "LegacyExercise" SET SCHEMA archive_v1;
ALTER TABLE "LegacyDocumentAnalysis" SET SCHEMA archive_v1;
ALTER TABLE "LegacyDocumentChunk" SET SCHEMA archive_v1;
ALTER TABLE "ConceptStat" SET SCHEMA archive_v1;
ALTER TABLE "StudyRecommendation" SET SCHEMA archive_v1;
ALTER TABLE "ProgramRun" SET SCHEMA archive_v1;
ALTER TABLE "SqlQueryLog" SET SCHEMA archive_v1;
ALTER TABLE "ChatMessage" SET SCHEMA archive_v1;
ALTER TABLE "Chapter" SET SCHEMA archive_v1;
-- Les colonnes Document.chapterId et Document.extractedText sont conservées (vides pour les nouveaux imports).
