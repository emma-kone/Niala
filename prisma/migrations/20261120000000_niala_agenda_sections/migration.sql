-- Niala : agenda séparé en « Emplois du temps » et « Tâches et rappels ».
-- Un emploi du temps peut désormais être créé à la main (sans fichier). Migration purement additive.

ALTER TABLE "public"."ScheduleImport" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'IMPORT';
