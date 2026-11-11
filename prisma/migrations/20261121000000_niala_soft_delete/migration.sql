-- Suppression « douce » : un contenu supprimé par l'étudiant est masqué dans l'application mais conservé pour les
-- statistiques ; un compte supprimé est anonymisé (identité effacée, activité conservée). Aucune donnée n'est modifiée ici.

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "Subject" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "Folder" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "Document" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "Exercise" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "MindMap" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "Conversation" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "Note" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "NoteLink" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "AcademicTask" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "StudySession" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "ScheduleBreak" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "ScheduleEvent" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "ScheduleImport" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "LabWorkspace" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "Concept" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "CourseSection" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);

-- Les lectures de l'application filtrent sur « deletedAt IS NULL » : index partiels sur les tables les plus lues.
CREATE INDEX IF NOT EXISTS "Subject_userId_alive_idx" ON "Subject" ("userId") WHERE "deletedAt" IS NULL;
CREATE INDEX IF NOT EXISTS "Document_userId_alive_idx" ON "Document" ("userId") WHERE "deletedAt" IS NULL;
CREATE INDEX IF NOT EXISTS "Exercise_userId_alive_idx" ON "Exercise" ("userId") WHERE "deletedAt" IS NULL;
CREATE INDEX IF NOT EXISTS "Conversation_userId_alive_idx" ON "Conversation" ("userId") WHERE "deletedAt" IS NULL;
CREATE INDEX IF NOT EXISTS "Note_userId_alive_idx" ON "Note" ("userId") WHERE "deletedAt" IS NULL;
CREATE INDEX IF NOT EXISTS "MindMap_userId_alive_idx" ON "MindMap" ("userId") WHERE "deletedAt" IS NULL;
