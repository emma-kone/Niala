-- Niala : classe saisie librement et niveau « Autre » précisé par l'étudiant. Migration additive.
ALTER TABLE "public"."StudentProfile"
  ADD COLUMN "className" TEXT,
  ADD COLUMN "levelOther" TEXT;
