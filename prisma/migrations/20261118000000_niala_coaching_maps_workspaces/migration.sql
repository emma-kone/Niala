-- Niala : suggestions pédagogiques, cartes mentales directes, environnements de travail. Migration additive.

-- Objectif hebdomadaire de l'étudiant
ALTER TABLE "public"."UserSettings" ADD COLUMN "weeklyGoal" INTEGER NOT NULL DEFAULT 0;

-- Conseils écartés
CREATE TABLE "public"."CoachDismissal" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "until" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CoachDismissal_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CoachDismissal_userId_key_key" ON "public"."CoachDismissal"("userId", "key");
ALTER TABLE "public"."CoachDismissal" ADD CONSTRAINT "CoachDismissal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "public"."CoachDismissal" ENABLE ROW LEVEL SECURITY;

-- Versions de la production d'un espace de travail
CREATE TABLE "public"."WorkspaceRevision" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "attemptId" TEXT NOT NULL,
  "position" INTEGER NOT NULL,
  "number" INTEGER NOT NULL,
  "data" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WorkspaceRevision_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "WorkspaceRevision_attemptId_position_number_key" ON "public"."WorkspaceRevision"("attemptId", "position", "number");
CREATE INDEX "WorkspaceRevision_userId_idx" ON "public"."WorkspaceRevision"("userId");
ALTER TABLE "public"."WorkspaceRevision" ADD CONSTRAINT "WorkspaceRevision_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "public"."WorkspaceRevision" ADD CONSTRAINT "WorkspaceRevision_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "public"."ExerciseAttempt"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "public"."WorkspaceRevision" ENABLE ROW LEVEL SECURITY;

-- Cartes mentales : matière facultative, cours d'origine
ALTER TABLE "public"."MindMap" ALTER COLUMN "subjectId" DROP NOT NULL;
ALTER TABLE "public"."MindMap" ADD COLUMN "documentId" TEXT;
ALTER TABLE "public"."MindMap" ADD CONSTRAINT "MindMap_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "public"."Document"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "MindMap_documentId_idx" ON "public"."MindMap"("documentId");
