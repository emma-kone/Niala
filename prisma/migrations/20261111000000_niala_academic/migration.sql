-- Agenda académique : séances à dates précises, pauses propres à chaque étudiant, échéances et séances de travail. Ajouts uniquement.
ALTER TABLE "public"."ScheduleEvent" ADD COLUMN "dates" JSONB, ADD COLUMN "endDate" TEXT, ADD COLUMN "allDay" BOOLEAN NOT NULL DEFAULT false, ADD COLUMN "code" TEXT, ADD COLUMN "sessionType" TEXT;
ALTER TABLE "public"."UserSettings" ADD COLUMN "agendaPrefs" JSONB;
CREATE TABLE "public"."ScheduleBreak" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "importId" TEXT,
    "label" TEXT NOT NULL DEFAULT 'Pause',
    "startMinutes" INTEGER NOT NULL,
    "endMinutes" INTEGER NOT NULL,
    "weekday" INTEGER,
    CONSTRAINT "ScheduleBreak_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "public"."AcademicTask" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "subjectId" TEXT,
    "documentId" TEXT,
    "exerciseId" TEXT,
    "parentId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "type" TEXT NOT NULL DEFAULT 'DEVOIR',
    "priority" TEXT NOT NULL DEFAULT 'NORMALE',
    "status" TEXT NOT NULL DEFAULT 'A_COMMENCER',
    "dueDate" TEXT NOT NULL,
    "dueMinutes" INTEGER,
    "estimatedMinutes" INTEGER,
    "requiresSubmission" BOOLEAN NOT NULL DEFAULT false,
    "reminderMinutes" JSONB,
    "recurrence" TEXT NOT NULL DEFAULT 'NONE',
    "completedAt" TIMESTAMP(3),
    "submittedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AcademicTask_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "public"."StudySession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "startMinutes" INTEGER NOT NULL,
    "endMinutes" INTEGER NOT NULL,
    "done" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "StudySession_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ScheduleBreak_userId_idx" ON "public"."ScheduleBreak"("userId");
CREATE INDEX "AcademicTask_userId_dueDate_idx" ON "public"."AcademicTask"("userId", "dueDate");
CREATE INDEX "StudySession_userId_date_idx" ON "public"."StudySession"("userId", "date");
ALTER TABLE "public"."ScheduleBreak" ADD CONSTRAINT "ScheduleBreak_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "public"."ScheduleBreak" ADD CONSTRAINT "ScheduleBreak_importId_fkey" FOREIGN KEY ("importId") REFERENCES "public"."ScheduleImport"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "public"."AcademicTask" ADD CONSTRAINT "AcademicTask_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "public"."AcademicTask" ADD CONSTRAINT "AcademicTask_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "public"."Subject"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "public"."AcademicTask" ADD CONSTRAINT "AcademicTask_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "public"."Document"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "public"."AcademicTask" ADD CONSTRAINT "AcademicTask_exerciseId_fkey" FOREIGN KEY ("exerciseId") REFERENCES "public"."Exercise"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "public"."AcademicTask" ADD CONSTRAINT "AcademicTask_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "public"."AcademicTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "public"."StudySession" ADD CONSTRAINT "StudySession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "public"."StudySession" ADD CONSTRAINT "StudySession_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "public"."AcademicTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "public"."ScheduleBreak" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."AcademicTask" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."StudySession" ENABLE ROW LEVEL SECURITY;
