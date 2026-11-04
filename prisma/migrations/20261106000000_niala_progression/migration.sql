-- Niala : états de progression des notions et observations par compétence. Migration ADDITIVE.

ALTER TABLE "public"."ConceptMastery" ADD COLUMN "state" TEXT NOT NULL DEFAULT 'NOT_ASSESSED';
ALTER TABLE "public"."ConceptMastery" ADD COLUMN "needsRecheck" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "public"."ConceptMastery" ADD COLUMN "stateReasons" JSONB;

CREATE TABLE "public"."SkillObservation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "skill" TEXT NOT NULL,
    "activity" TEXT NOT NULL,
    "language" TEXT,
    "category" "public"."ErrorCategory",
    "conceptId" TEXT,
    "reportId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SkillObservation_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SkillObservation_userId_skill_createdAt_idx" ON "public"."SkillObservation"("userId", "skill", "createdAt");
CREATE INDEX "SkillObservation_reportId_idx" ON "public"."SkillObservation"("reportId");

ALTER TABLE "public"."SkillObservation" ADD CONSTRAINT "SkillObservation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "public"."SkillObservation" ADD CONSTRAINT "SkillObservation_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "public"."DiagnosisReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "public"."SkillObservation" ENABLE ROW LEVEL SECURITY;
