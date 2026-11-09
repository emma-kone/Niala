-- Niala : profil académique, préférences réelles, exercices sans matière, tuteur pendant la résolution.
-- Migration purement additive : aucune colonne ni donnée existante n'est supprimée.

-- Sessions : un numéro de version permet de fermer toutes les sessions d'un compte.
ALTER TABLE "public"."User" ADD COLUMN "sessionVersion" INTEGER NOT NULL DEFAULT 0;

-- Préférences
ALTER TABLE "public"."UserSettings"
  ADD COLUMN "textSize" TEXT NOT NULL DEFAULT 'normal',
  ADD COLUMN "correctionPref" TEXT NOT NULL DEFAULT 'final',
  ADD COLUMN "explanationLevel" TEXT NOT NULL DEFAULT 'standard',
  ADD COLUMN "notifyProgress" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "notifyRevision" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "notifyActivities" BOOLEAN NOT NULL DEFAULT true;

-- Profil
CREATE TABLE "public"."StudentProfile" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "category" TEXT,
  "institution" TEXT,
  "fieldCode" TEXT,
  "field" TEXT,
  "level" TEXT,
  "situation" TEXT,
  "usageReason" TEXT,
  "avatar" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "StudentProfile_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "StudentProfile_userId_key" ON "public"."StudentProfile"("userId");
ALTER TABLE "public"."StudentProfile" ADD CONSTRAINT "StudentProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Exercices : matière facultative, origine, exercice ponctuel
ALTER TABLE "public"."Exercise"
  ALTER COLUMN "subjectId" DROP NOT NULL,
  ADD COLUMN "origin" TEXT NOT NULL DEFAULT 'DOCUMENT',
  ADD COLUMN "saved" BOOLEAN NOT NULL DEFAULT true;

-- Tuteur
CREATE TABLE "public"."AttemptTutorMessage" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "attemptId" TEXT NOT NULL,
  "position" INTEGER NOT NULL,
  "role" "public"."ChatRole" NOT NULL,
  "kind" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AttemptTutorMessage_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AttemptTutorMessage_attemptId_position_createdAt_idx" ON "public"."AttemptTutorMessage"("attemptId", "position", "createdAt");
CREATE INDEX "AttemptTutorMessage_userId_idx" ON "public"."AttemptTutorMessage"("userId");
ALTER TABLE "public"."AttemptTutorMessage" ADD CONSTRAINT "AttemptTutorMessage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "public"."AttemptTutorMessage" ADD CONSTRAINT "AttemptTutorMessage_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "public"."ExerciseAttempt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Index des requêtes du tableau de bord, des listes et du quota d'IA
DROP INDEX IF EXISTS "public"."Exercise_userId_idx";
CREATE INDEX "Exercise_userId_saved_createdAt_idx" ON "public"."Exercise"("userId", "saved", "createdAt");
DROP INDEX IF EXISTS "public"."ExerciseAttempt_userId_status_idx";
CREATE INDEX "ExerciseAttempt_userId_status_finishedAt_idx" ON "public"."ExerciseAttempt"("userId", "status", "finishedAt");
DROP INDEX IF EXISTS "public"."AIUsageLog_userId_idx";
CREATE INDEX "AIUsageLog_userId_createdAt_idx" ON "public"."AIUsageLog"("userId", "createdAt");
DROP INDEX IF EXISTS "public"."Document_userId_idx";
CREATE INDEX "Document_userId_lastOpenedAt_idx" ON "public"."Document"("userId", "lastOpenedAt");
DROP INDEX IF EXISTS "public"."LabRun_userId_idx";
CREATE INDEX "LabRun_userId_createdAt_idx" ON "public"."LabRun"("userId", "createdAt");

-- Sécurité : aucune nouvelle table n'est accessible par l'API publique de Supabase.
ALTER TABLE "public"."StudentProfile" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."AttemptTutorMessage" ENABLE ROW LEVEL SECURITY;
