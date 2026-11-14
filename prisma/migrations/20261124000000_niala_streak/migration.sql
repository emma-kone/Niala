-- Série de jours consécutifs d'activité : une ligne par étudiant et par jour (date de l'appareil, AAAA-MM-JJ).
-- Table nouvelle : aucune donnée existante n'est modifiée.

CREATE TABLE IF NOT EXISTS "ActivityDay" (
  "userId" TEXT NOT NULL,
  "day" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ActivityDay_pkey" PRIMARY KEY ("userId", "day"),
  CONSTRAINT "ActivityDay_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
ALTER TABLE "public"."ActivityDay" ENABLE ROW LEVEL SECURITY;
