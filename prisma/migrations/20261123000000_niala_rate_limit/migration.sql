-- Limitation de débit partagée entre toutes les instances du serveur (les compteurs en mémoire sont propres à chaque
-- instance et ne protègent donc pas sur un hébergement « serverless »). La clé est une empreinte HMAC : ni adresse IP
-- ni adresse e-mail n'est conservée en clair. Aucune donnée existante n'est modifiée.

CREATE TABLE IF NOT EXISTS "RateLimit" (
  "key" TEXT NOT NULL,
  "count" INTEGER NOT NULL DEFAULT 0,
  "resetAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RateLimit_pkey" PRIMARY KEY ("key")
);
CREATE INDEX IF NOT EXISTS "RateLimit_resetAt_idx" ON "RateLimit" ("resetAt");
ALTER TABLE "public"."RateLimit" ENABLE ROW LEVEL SECURITY;
