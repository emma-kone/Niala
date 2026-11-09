-- Retire les restes de la fonctionnalité de diagnostic annulée le 4 novembre (commit a417feb) :
-- ces objets existent encore dans la base déployée alors qu'ils ne sont plus dans schema.prisma.
-- Les IF EXISTS sont volontaires : une base neuve, montée depuis ce dossier, ne les a jamais eus.

DROP TABLE IF EXISTS "public"."DiagnosisFollowup";
DROP TABLE IF EXISTS "public"."SkillObservation";
DROP TABLE IF EXISTS "public"."DiagnosisReport";
DROP TABLE IF EXISTS "public"."ExerciseSource";

ALTER TABLE "public"."ConceptMastery"
  DROP COLUMN IF EXISTS "state",
  DROP COLUMN IF EXISTS "needsRecheck",
  DROP COLUMN IF EXISTS "stateReasons";

DROP TYPE IF EXISTS "public"."DiagnosisState";

-- PostgreSQL ne sait pas retirer une valeur d'un enum : on le recrée sans ALGORITHM ni ENVIRONMENT.
CREATE TYPE "public"."ErrorCategory_new" AS ENUM ('SYNTAX', 'LOGIC', 'CONCEPT', 'METHOD', 'INSTRUCTION', 'FORGETTING', 'CARELESS');
ALTER TABLE "public"."ErrorDiagnosis"
  ALTER COLUMN "category" TYPE "public"."ErrorCategory_new" USING ("category"::text::"public"."ErrorCategory_new");
DROP TYPE "public"."ErrorCategory";
ALTER TYPE "public"."ErrorCategory_new" RENAME TO "ErrorCategory";

-- Aligne la valeur par défaut sur schema.prisma.
ALTER TABLE "public"."UserSettings" ALTER COLUMN "aiModel" SET DEFAULT 'claude-sonnet-5-5';
