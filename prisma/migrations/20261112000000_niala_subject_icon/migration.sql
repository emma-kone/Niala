-- Icône persistante de chaque matière (attribuée au premier chargement pour les matières existantes).
ALTER TABLE "Subject" ADD COLUMN "icon" TEXT;
ALTER TABLE "Subject" ADD COLUMN "iconAuto" BOOLEAN NOT NULL DEFAULT true;
