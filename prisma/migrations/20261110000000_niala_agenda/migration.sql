-- Agenda : emploi du temps, modifications ponctuelles et imports. Tables nouvelles uniquement.
CREATE TABLE "public"."ScheduleImport" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'REVIEW',
    "draft" JSONB NOT NULL,
    "warnings" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmedAt" TIMESTAMP(3),
    CONSTRAINT "ScheduleImport_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "public"."ScheduleEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "subjectId" TEXT,
    "importId" TEXT,
    "title" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'COURSE',
    "date" TEXT NOT NULL,
    "startMinutes" INTEGER NOT NULL,
    "endMinutes" INTEGER NOT NULL,
    "recurrence" TEXT NOT NULL DEFAULT 'NONE',
    "until" TEXT,
    "weekPattern" TEXT NOT NULL DEFAULT 'ALL',
    "room" TEXT,
    "teacher" TEXT,
    "groupName" TEXT,
    "description" TEXT,
    "confidence" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ScheduleEvent_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "public"."ScheduleOverride" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "cancelled" BOOLEAN NOT NULL DEFAULT false,
    "newDate" TEXT,
    "startMinutes" INTEGER,
    "endMinutes" INTEGER,
    "subjectId" TEXT,
    "title" TEXT,
    "room" TEXT,
    "teacher" TEXT,
    "description" TEXT,
    CONSTRAINT "ScheduleOverride_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ScheduleImport_userId_createdAt_idx" ON "public"."ScheduleImport"("userId", "createdAt");
CREATE INDEX "ScheduleEvent_userId_date_idx" ON "public"."ScheduleEvent"("userId", "date");
CREATE INDEX "ScheduleEvent_importId_idx" ON "public"."ScheduleEvent"("importId");
CREATE UNIQUE INDEX "ScheduleOverride_eventId_date_key" ON "public"."ScheduleOverride"("eventId", "date");
ALTER TABLE "public"."ScheduleImport" ADD CONSTRAINT "ScheduleImport_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "public"."ScheduleEvent" ADD CONSTRAINT "ScheduleEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "public"."ScheduleEvent" ADD CONSTRAINT "ScheduleEvent_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "public"."Subject"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "public"."ScheduleEvent" ADD CONSTRAINT "ScheduleEvent_importId_fkey" FOREIGN KEY ("importId") REFERENCES "public"."ScheduleImport"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "public"."ScheduleOverride" ADD CONSTRAINT "ScheduleOverride_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "public"."ScheduleEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "public"."ScheduleImport" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."ScheduleEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."ScheduleOverride" ENABLE ROW LEVEL SECURITY;

-- Convention A/B de l'établissement.
ALTER TABLE "public"."UserSettings" ADD COLUMN "scheduleWeekSwap" BOOLEAN NOT NULL DEFAULT false;

-- Nouvelle identité visuelle : le thème clair devient le thème par défaut (réversible depuis les Réglages).
ALTER TABLE "public"."UserSettings" ALTER COLUMN "theme" SET DEFAULT 'light';
UPDATE "public"."UserSettings" SET "theme" = 'light' WHERE "theme" = 'dark';
