-- Niala : moteur de diagnostic pédagogique unifié. Migration ADDITIVE : aucune donnée existante n'est modifiée.

ALTER TYPE "public"."ErrorCategory" ADD VALUE IF NOT EXISTS 'ALGORITHM';
ALTER TYPE "public"."ErrorCategory" ADD VALUE IF NOT EXISTS 'ENVIRONMENT';

CREATE TYPE "public"."DiagnosisState" AS ENUM ('NONE', 'DETERMINED', 'UNCERTAIN');

CREATE TABLE "public"."DiagnosisReport" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "activity" TEXT NOT NULL,
    "answerId" TEXT,
    "labRunId" TEXT,
    "subjectId" TEXT,
    "language" TEXT,
    "primary" "public"."ErrorCategory",
    "secondary" JSONB NOT NULL,
    "state" "public"."DiagnosisState" NOT NULL,
    "summary" TEXT NOT NULL,
    "evidence" JSONB NOT NULL,
    "expected" JSONB,
    "observed" JSONB,
    "concepts" JSONB NOT NULL,
    "prerequisites" JSONB NOT NULL,
    "severity" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "pedagogical" BOOLEAN NOT NULL DEFAULT true,
    "recommendedAction" TEXT NOT NULL,
    "needsVerification" BOOLEAN NOT NULL DEFAULT false,
    "source" TEXT NOT NULL,
    "engineVersion" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DiagnosisReport_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "DiagnosisReport_userId_createdAt_idx" ON "public"."DiagnosisReport"("userId", "createdAt");
CREATE INDEX "DiagnosisReport_answerId_idx" ON "public"."DiagnosisReport"("answerId");
CREATE INDEX "DiagnosisReport_labRunId_idx" ON "public"."DiagnosisReport"("labRunId");

ALTER TABLE "public"."DiagnosisReport" ADD CONSTRAINT "DiagnosisReport_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "public"."DiagnosisReport" ADD CONSTRAINT "DiagnosisReport_answerId_fkey" FOREIGN KEY ("answerId") REFERENCES "public"."Answer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "public"."DiagnosisReport" ADD CONSTRAINT "DiagnosisReport_labRunId_fkey" FOREIGN KEY ("labRunId") REFERENCES "public"."LabRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "public"."DiagnosisReport" ENABLE ROW LEVEL SECURITY;
