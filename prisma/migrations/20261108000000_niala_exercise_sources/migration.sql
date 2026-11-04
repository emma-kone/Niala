-- Niala : exercices multi-sources. Chaque exercice garde ses sources et la VERSION exacte de chaque document. Migration ADDITIVE.

CREATE TABLE "public"."ExerciseSource" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "exerciseId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "documentId" TEXT,
    "versionId" TEXT,
    "documentName" TEXT NOT NULL,
    "versionNumber" INTEGER,
    "coverage" JSONB NOT NULL,
    CONSTRAINT "ExerciseSource_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ExerciseSource_exerciseId_position_idx" ON "public"."ExerciseSource"("exerciseId", "position");
CREATE INDEX "ExerciseSource_userId_idx" ON "public"."ExerciseSource"("userId");

ALTER TABLE "public"."ExerciseSource" ADD CONSTRAINT "ExerciseSource_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "public"."ExerciseSource" ADD CONSTRAINT "ExerciseSource_exerciseId_fkey" FOREIGN KEY ("exerciseId") REFERENCES "public"."Exercise"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "public"."ExerciseSource" ADD CONSTRAINT "ExerciseSource_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "public"."Document"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "public"."ExerciseSource" ADD CONSTRAINT "ExerciseSource_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "public"."DocumentVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Reprise : les exercices existants (un seul document) reçoivent leur source unique.
INSERT INTO "public"."ExerciseSource" ("id", "userId", "exerciseId", "position", "documentId", "versionId", "documentName", "versionNumber", "coverage")
SELECT concat('src_', e."id"), e."userId", e."id", 1, e."documentId", e."versionId", COALESCE(d."name", '(document supprimé)'), v."number", COALESCE(e."config"->'coverage', '{"mode":"all"}'::jsonb)
FROM "public"."Exercise" e
LEFT JOIN "public"."Document" d ON d."id" = e."documentId"
LEFT JOIN "public"."DocumentVersion" v ON v."id" = e."versionId"
WHERE e."documentId" IS NOT NULL;

ALTER TABLE "public"."ExerciseSource" ENABLE ROW LEVEL SECURITY;
