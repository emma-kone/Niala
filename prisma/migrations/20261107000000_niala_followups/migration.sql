-- Niala : interprétation IA validée, aides graduées et questions de vérification. Migration ADDITIVE.

ALTER TABLE "public"."DiagnosisReport" ADD COLUMN "facts" JSONB;
ALTER TABLE "public"."DiagnosisReport" ADD COLUMN "ai" JSONB;

CREATE TABLE "public"."DiagnosisFollowup" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "answer" TEXT,
    "assessment" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "answeredAt" TIMESTAMP(3),
    CONSTRAINT "DiagnosisFollowup_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "DiagnosisFollowup_reportId_idx" ON "public"."DiagnosisFollowup"("reportId");
CREATE INDEX "DiagnosisFollowup_userId_createdAt_idx" ON "public"."DiagnosisFollowup"("userId", "createdAt");

ALTER TABLE "public"."DiagnosisFollowup" ADD CONSTRAINT "DiagnosisFollowup_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "public"."DiagnosisFollowup" ADD CONSTRAINT "DiagnosisFollowup_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "public"."DiagnosisReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "public"."DiagnosisFollowup" ENABLE ROW LEVEL SECURITY;
