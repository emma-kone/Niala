-- Fiabilité : conservation des vérifications, sources, affirmations et preuves. Migration purement additive.
CREATE TABLE "public"."VerificationRun" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "feature" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "webStatus" TEXT NOT NULL,
    "summary" JSONB NOT NULL,
    "limits" JSONB NOT NULL,
    "rejectedCitations" INTEGER NOT NULL DEFAULT 0,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "VerificationRun_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "public"."SourceSnapshot" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "n" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "url" TEXT,
    "host" TEXT,
    "organization" TEXT,
    "documentId" TEXT,
    "page" INTEGER,
    "level" INTEGER,
    "sourceKind" TEXT,
    "publishedAt" TEXT,
    "excerpt" TEXT NOT NULL,
    "retrievedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SourceSnapshot_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "public"."Claim" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "claimType" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "confidence" TEXT NOT NULL,
    "basis" TEXT NOT NULL,
    "reason" TEXT,
    "limits" JSONB NOT NULL,
    "courseConflict" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "Claim_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "public"."ClaimEvidence" (
    "id" TEXT NOT NULL,
    "claimId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "stance" TEXT NOT NULL,
    "quote" TEXT NOT NULL,
    "direct" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "ClaimEvidence_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "VerificationRun_userId_feature_idx" ON "public"."VerificationRun"("userId", "feature");
CREATE INDEX "VerificationRun_entityType_entityId_idx" ON "public"."VerificationRun"("entityType", "entityId");
CREATE INDEX "SourceSnapshot_runId_idx" ON "public"."SourceSnapshot"("runId");
CREATE INDEX "Claim_runId_idx" ON "public"."Claim"("runId");
CREATE INDEX "ClaimEvidence_claimId_idx" ON "public"."ClaimEvidence"("claimId");
CREATE INDEX "ClaimEvidence_sourceId_idx" ON "public"."ClaimEvidence"("sourceId");
ALTER TABLE "public"."VerificationRun" ADD CONSTRAINT "VerificationRun_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "public"."SourceSnapshot" ADD CONSTRAINT "SourceSnapshot_runId_fkey" FOREIGN KEY ("runId") REFERENCES "public"."VerificationRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "public"."Claim" ADD CONSTRAINT "Claim_runId_fkey" FOREIGN KEY ("runId") REFERENCES "public"."VerificationRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "public"."ClaimEvidence" ADD CONSTRAINT "ClaimEvidence_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "public"."Claim"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "public"."ClaimEvidence" ADD CONSTRAINT "ClaimEvidence_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "public"."SourceSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- Mêmes protections que les autres tables : pas d'accès direct par l'API REST publique.
ALTER TABLE "public"."VerificationRun" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."SourceSnapshot" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."Claim" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."ClaimEvidence" ENABLE ROW LEVEL SECURITY;
