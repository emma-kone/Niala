-- Assistance sans compte (depuis la page de connexion), suppression des demandes et des annonces par l'équipe,
-- annonces par e-mail et notifications push. Aucune donnée existante n'est modifiée.

ALTER TABLE "SupportRequest" ALTER COLUMN "userId" DROP NOT NULL;
ALTER TABLE "SupportRequest" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "SupportRequest" ADD COLUMN IF NOT EXISTS "guestEmail" TEXT;
ALTER TABLE "SupportRequest" ADD COLUMN IF NOT EXISTS "guestName" TEXT;
ALTER TABLE "SupportRequest" ADD COLUMN IF NOT EXISTS "guestNonce" TEXT;
CREATE INDEX IF NOT EXISTS "SupportRequest_guestEmail_idx" ON "SupportRequest" ("guestEmail") WHERE "guestEmail" IS NOT NULL;

ALTER TABLE "Announcement" ADD COLUMN IF NOT EXISTS "channels" JSONB;
ALTER TABLE "Announcement" ADD COLUMN IF NOT EXISTS "emailSent" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Announcement" ADD COLUMN IF NOT EXISTS "pushSent" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Announcement" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);

ALTER TABLE "UserSettings" ADD COLUMN IF NOT EXISTS "emailAnnouncements" BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE IF NOT EXISTS "PushSubscription" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "endpoint" TEXT NOT NULL,
  "p256dh" TEXT NOT NULL,
  "auth" TEXT NOT NULL,
  "userAgent" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastUsedAt" TIMESTAMP(3),
  CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PushSubscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "PushSubscription_endpoint_key" ON "PushSubscription" ("endpoint");
CREATE INDEX IF NOT EXISTS "PushSubscription_userId_idx" ON "PushSubscription" ("userId");
ALTER TABLE "public"."PushSubscription" ENABLE ROW LEVEL SECURITY;
