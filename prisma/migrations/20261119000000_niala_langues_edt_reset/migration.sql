-- Niala : langue de discussion avec l'IA, langue propre à chaque exercice, plusieurs emplois du temps
-- (l'étudiant choisit celui à suivre) et réinitialisation du mot de passe.
-- Migration purement additive : aucune colonne ni donnée existante n'est supprimée ou modifiée.

ALTER TABLE "public"."UserSettings"
  ADD COLUMN "chatLang" TEXT NOT NULL DEFAULT 'fr',
  ADD COLUMN "activeScheduleId" TEXT;

ALTER TABLE "public"."Exercise" ADD COLUMN "language" TEXT;

ALTER TABLE "public"."ScheduleImport" ADD COLUMN "label" TEXT;

CREATE TABLE "public"."PasswordResetToken" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "usedAt" TIMESTAMP(3),
  "createdBy" TEXT NOT NULL DEFAULT 'USER',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PasswordResetToken_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PasswordResetToken_tokenHash_key" ON "public"."PasswordResetToken"("tokenHash");
CREATE INDEX "PasswordResetToken_userId_createdAt_idx" ON "public"."PasswordResetToken"("userId", "createdAt");
ALTER TABLE "public"."PasswordResetToken" ADD CONSTRAINT "PasswordResetToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "public"."PasswordResetToken" ENABLE ROW LEVEL SECURITY;
