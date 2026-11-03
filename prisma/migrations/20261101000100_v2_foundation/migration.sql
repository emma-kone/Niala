-- StudyForge V2 — fondation du schéma (migration ADDITIVE : aucune donnée supprimée).
--
-- Étape 1 : les 4 tables V1 dont le nom est repris par la V2 sont RENOMMÉES (les
-- lignes sont conservées telles quelles) ainsi que leurs contraintes et index, pour
-- correspondre aux noms attendus par Prisma.
-- Étape 2 : création des nouvelles tables, enums et colonnes (nullables) de la V2.
-- Aucune table V1 n'est supprimée ici : la suppression (Chapter, Session*, ConceptStat…)
-- n'interviendra qu'après la reprise des données et sa vérification (voir docs/).

-- ── Étape 1 : renommage des tables V1 ────────────────────────────────────────

ALTER TABLE "DocumentChunk" RENAME TO "LegacyDocumentChunk";
ALTER TABLE "LegacyDocumentChunk" RENAME CONSTRAINT "DocumentChunk_pkey" TO "LegacyDocumentChunk_pkey";
ALTER TABLE "LegacyDocumentChunk" RENAME CONSTRAINT "DocumentChunk_documentId_fkey" TO "LegacyDocumentChunk_documentId_fkey";
ALTER INDEX "DocumentChunk_documentId_idx" RENAME TO "LegacyDocumentChunk_documentId_idx";

ALTER TABLE "DocumentAnalysis" RENAME TO "LegacyDocumentAnalysis";
ALTER TABLE "LegacyDocumentAnalysis" RENAME CONSTRAINT "DocumentAnalysis_pkey" TO "LegacyDocumentAnalysis_pkey";
ALTER TABLE "LegacyDocumentAnalysis" RENAME CONSTRAINT "DocumentAnalysis_documentId_fkey" TO "LegacyDocumentAnalysis_documentId_fkey";
ALTER INDEX "DocumentAnalysis_documentId_key" RENAME TO "LegacyDocumentAnalysis_documentId_key";

ALTER TABLE "Exercise" RENAME TO "LegacyExercise";
ALTER TABLE "LegacyExercise" RENAME CONSTRAINT "Exercise_pkey" TO "LegacyExercise_pkey";
ALTER TABLE "LegacyExercise" RENAME CONSTRAINT "Exercise_userId_fkey" TO "LegacyExercise_userId_fkey";
ALTER TABLE "LegacyExercise" RENAME CONSTRAINT "Exercise_subjectId_fkey" TO "LegacyExercise_subjectId_fkey";
ALTER INDEX "Exercise_userId_idx" RENAME TO "LegacyExercise_userId_idx";
ALTER INDEX "Exercise_subjectId_idx" RENAME TO "LegacyExercise_subjectId_idx";

ALTER TABLE "Answer" RENAME TO "LegacyAnswer";
ALTER TABLE "LegacyAnswer" RENAME CONSTRAINT "Answer_pkey" TO "LegacyAnswer_pkey";
ALTER TABLE "LegacyAnswer" RENAME CONSTRAINT "Answer_itemId_fkey" TO "LegacyAnswer_itemId_fkey";
ALTER INDEX "Answer_itemId_idx" RENAME TO "LegacyAnswer_itemId_idx";

-- ── Étape 2 : nouveaux objets V2 (généré par `prisma migrate diff`) ──────────

-- CreateEnum
CREATE TYPE "ExtractStatus" AS ENUM ('PENDING', 'PROCESSING', 'READY', 'PARTIAL', 'FAILED', 'UNSUPPORTED');

-- CreateEnum
CREATE TYPE "AnalysisStatus" AS ENUM ('PENDING', 'RUNNING', 'READY', 'FAILED');

-- CreateEnum
CREATE TYPE "Origin" AS ENUM ('DOCUMENT', 'AI_INFERRED', 'USER');

-- CreateEnum
CREATE TYPE "ConceptKind" AS ENUM ('NOTION', 'DEFINITION', 'PROPERTY', 'RULE', 'EXAMPLE');

-- CreateEnum
CREATE TYPE "RelationType" AS ENUM ('PREREQUISITE', 'PART_OF', 'EXAMPLE_OF', 'DEFINES', 'CONTRASTS', 'RELATED');

-- CreateEnum
CREATE TYPE "NoteKind" AS ENUM ('PERSONAL', 'DOCUMENT', 'ANNOTATION', 'SUMMARY');

-- CreateEnum
CREATE TYPE "MapKind" AS ENUM ('STRUCTURE', 'CONCEPT');

-- CreateEnum
CREATE TYPE "ExerciseStatus" AS ENUM ('READY', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "AttemptStatus" AS ENUM ('IN_PROGRESS', 'SUBMITTED', 'GRADED');

-- CreateEnum
CREATE TYPE "GradedBy" AS ENUM ('RULE', 'TEST', 'AI', 'MIXED');

-- CreateEnum
CREATE TYPE "ErrorCategory" AS ENUM ('SYNTAX', 'LOGIC', 'CONCEPT', 'METHOD', 'INSTRUCTION', 'FORGETTING', 'CARELESS');

-- CreateEnum
CREATE TYPE "ActivityStatus" AS ENUM ('SUGGESTED', 'IN_PROGRESS', 'DONE', 'DISMISSED');

-- CreateEnum
CREATE TYPE "LabKind" AS ENUM ('CODE', 'SQL');

-- CreateEnum
CREATE TYPE "LabMode" AS ENUM ('FREE', 'EXERCISE');

-- AlterTable
ALTER TABLE "Document" ADD COLUMN     "currentVersionId" TEXT,
ADD COLUMN     "folderId" TEXT,
ADD COLUMN     "lastOpenedAt" TIMESTAMP(3),
ADD COLUMN     "lastPage" INTEGER;

-- CreateTable
CREATE TABLE "Folder" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "parentId" TEXT,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Folder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentVersion" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "storageKey" TEXT,
    "originalMissing" BOOLEAN NOT NULL DEFAULT false,
    "mime" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "sha256" TEXT,
    "pageCount" INTEGER,
    "extractStatus" "ExtractStatus" NOT NULL DEFAULT 'PENDING',
    "extractError" TEXT,
    "extractWarnings" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentChunk" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "idx" INTEGER NOT NULL,
    "page" INTEGER,
    "charStart" INTEGER NOT NULL DEFAULT 0,
    "charEnd" INTEGER NOT NULL DEFAULT 0,
    "content" TEXT NOT NULL,
    "words" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "DocumentChunk_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentAnalysis" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "status" "AnalysisStatus" NOT NULL DEFAULT 'PENDING',
    "model" TEXT,
    "promptVersion" TEXT,
    "summary" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "DocumentAnalysis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CourseSection" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "analysisId" TEXT NOT NULL,
    "parentId" TEXT,
    "label" TEXT NOT NULL,
    "numbering" TEXT,
    "level" INTEGER NOT NULL DEFAULT 0,
    "position" INTEGER NOT NULL DEFAULT 0,
    "pageStart" INTEGER,
    "pageEnd" INTEGER,
    "origin" "Origin" NOT NULL DEFAULT 'DOCUMENT',
    "edited" BOOLEAN NOT NULL DEFAULT false,
    "refs" JSONB,

    CONSTRAINT "CourseSection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Concept" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "kind" "ConceptKind" NOT NULL DEFAULT 'NOTION',
    "importance" INTEGER NOT NULL DEFAULT 2,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Concept_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConceptSource" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "conceptId" TEXT NOT NULL,
    "analysisId" TEXT NOT NULL,
    "sectionId" TEXT,
    "origin" "Origin" NOT NULL DEFAULT 'DOCUMENT',
    "definition" TEXT,
    "refs" JSONB,

    CONSTRAINT "ConceptSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConceptRelation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "fromId" TEXT NOT NULL,
    "toId" TEXT NOT NULL,
    "type" "RelationType" NOT NULL DEFAULT 'RELATED',
    "origin" "Origin" NOT NULL DEFAULT 'AI_INFERRED',
    "refs" JSONB,

    CONSTRAINT "ConceptRelation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Note" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "kind" "NoteKind" NOT NULL DEFAULT 'PERSONAL',
    "title" TEXT NOT NULL DEFAULT '',
    "content" JSONB NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Note_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NoteLink" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "noteId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "versionId" TEXT,
    "page" INTEGER,
    "anchor" JSONB,

    CONSTRAINT "NoteLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MindMap" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "analysisId" TEXT,
    "kind" "MapKind" NOT NULL,
    "title" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MindMap_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MindMapNode" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "mapId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "x" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "y" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "origin" "Origin" NOT NULL DEFAULT 'AI_INFERRED',
    "conceptId" TEXT,
    "sectionId" TEXT,
    "data" JSONB,

    CONSTRAINT "MindMapNode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MindMapEdge" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "mapId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "type" "RelationType" NOT NULL DEFAULT 'RELATED',
    "label" TEXT,
    "origin" "Origin" NOT NULL DEFAULT 'AI_INFERRED',

    CONSTRAINT "MindMapEdge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MindMapRevision" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "mapId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MindMapRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Exercise" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "documentId" TEXT,
    "versionId" TEXT,
    "title" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "totalPoints" DOUBLE PRECISION NOT NULL,
    "status" "ExerciseStatus" NOT NULL DEFAULT 'READY',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Exercise_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Question" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "exerciseId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "points" DOUBLE PRECISION NOT NULL,
    "difficulty" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "answerKey" JSONB NOT NULL,
    "explanation" TEXT,
    "sourceRefs" JSONB,

    CONSTRAINT "Question_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuestionConcept" (
    "questionId" TEXT NOT NULL,
    "conceptId" TEXT NOT NULL,

    CONSTRAINT "QuestionConcept_pkey" PRIMARY KEY ("questionId","conceptId")
);

-- CreateTable
CREATE TABLE "ExerciseAttempt" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "exerciseId" TEXT,
    "snapshot" JSONB NOT NULL,
    "status" "AttemptStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "finishedAt" TIMESTAMP(3),
    "lastPosition" INTEGER NOT NULL DEFAULT 0,
    "durationSec" INTEGER,
    "score" DOUBLE PRECISION,
    "maxScore" DOUBLE PRECISION,

    CONSTRAINT "ExerciseAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Answer" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "attemptId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "value" JSONB NOT NULL,
    "feedback" JSONB,
    "verdict" TEXT,
    "points" DOUBLE PRECISION,
    "gradedBy" "GradedBy",
    "tries" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Answer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ErrorDiagnosis" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "answerId" TEXT,
    "labRunId" TEXT,
    "conceptId" TEXT,
    "category" "ErrorCategory" NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "evidence" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ErrorDiagnosis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConceptMastery" (
    "conceptId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "level" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "evidenceCount" INTEGER NOT NULL DEFAULT 0,
    "lastEvidenceAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConceptMastery_pkey" PRIMARY KEY ("conceptId")
);

-- CreateTable
CREATE TABLE "LearningActivity" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "subjectId" TEXT,
    "type" TEXT NOT NULL,
    "refType" TEXT,
    "refId" TEXT,
    "title" TEXT NOT NULL,
    "status" "ActivityStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "lastPosition" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LearningActivity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LearningRecommendation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "subjectId" TEXT,
    "conceptId" TEXT,
    "activityType" TEXT NOT NULL,
    "reason" JSONB NOT NULL,
    "status" "ActivityStatus" NOT NULL DEFAULT 'SUGGESTED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LearningRecommendation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LabWorkspace" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "subjectId" TEXT,
    "exerciseId" TEXT,
    "kind" "LabKind" NOT NULL,
    "mode" "LabMode" NOT NULL DEFAULT 'FREE',
    "title" TEXT NOT NULL,
    "files" JSONB NOT NULL,
    "brief" JSONB,
    "schemaSql" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LabWorkspace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LabRun" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "input" JSONB NOT NULL,
    "output" JSONB NOT NULL,
    "tests" JSONB,
    "evaluation" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LabRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Folder_userId_idx" ON "Folder"("userId");

-- CreateIndex
CREATE INDEX "Folder_subjectId_parentId_idx" ON "Folder"("subjectId", "parentId");

-- CreateIndex
CREATE UNIQUE INDEX "Folder_subjectId_parentId_name_key" ON "Folder"("subjectId", "parentId", "name");

-- CreateIndex
CREATE INDEX "DocumentVersion_userId_idx" ON "DocumentVersion"("userId");

-- CreateIndex
CREATE INDEX "DocumentVersion_sha256_idx" ON "DocumentVersion"("sha256");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentVersion_documentId_number_key" ON "DocumentVersion"("documentId", "number");

-- CreateIndex
CREATE INDEX "DocumentChunk_userId_idx" ON "DocumentChunk"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentChunk_versionId_idx_key" ON "DocumentChunk"("versionId", "idx");

-- CreateIndex
CREATE INDEX "DocumentAnalysis_userId_idx" ON "DocumentAnalysis"("userId");

-- CreateIndex
CREATE INDEX "DocumentAnalysis_versionId_createdAt_idx" ON "DocumentAnalysis"("versionId", "createdAt");

-- CreateIndex
CREATE INDEX "CourseSection_userId_idx" ON "CourseSection"("userId");

-- CreateIndex
CREATE INDEX "CourseSection_analysisId_parentId_position_idx" ON "CourseSection"("analysisId", "parentId", "position");

-- CreateIndex
CREATE INDEX "Concept_userId_idx" ON "Concept"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Concept_subjectId_normalizedName_kind_key" ON "Concept"("subjectId", "normalizedName", "kind");

-- CreateIndex
CREATE INDEX "ConceptSource_userId_idx" ON "ConceptSource"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ConceptSource_conceptId_analysisId_sectionId_key" ON "ConceptSource"("conceptId", "analysisId", "sectionId");

-- CreateIndex
CREATE INDEX "ConceptRelation_userId_idx" ON "ConceptRelation"("userId");

-- CreateIndex
CREATE INDEX "ConceptRelation_subjectId_idx" ON "ConceptRelation"("subjectId");

-- CreateIndex
CREATE UNIQUE INDEX "ConceptRelation_fromId_toId_type_key" ON "ConceptRelation"("fromId", "toId", "type");

-- CreateIndex
CREATE INDEX "Note_userId_idx" ON "Note"("userId");

-- CreateIndex
CREATE INDEX "Note_subjectId_kind_updatedAt_idx" ON "Note"("subjectId", "kind", "updatedAt");

-- CreateIndex
CREATE INDEX "NoteLink_userId_idx" ON "NoteLink"("userId");

-- CreateIndex
CREATE INDEX "NoteLink_noteId_idx" ON "NoteLink"("noteId");

-- CreateIndex
CREATE INDEX "NoteLink_documentId_page_idx" ON "NoteLink"("documentId", "page");

-- CreateIndex
CREATE INDEX "MindMap_userId_idx" ON "MindMap"("userId");

-- CreateIndex
CREATE INDEX "MindMap_subjectId_idx" ON "MindMap"("subjectId");

-- CreateIndex
CREATE INDEX "MindMapNode_userId_idx" ON "MindMapNode"("userId");

-- CreateIndex
CREATE INDEX "MindMapNode_mapId_idx" ON "MindMapNode"("mapId");

-- CreateIndex
CREATE INDEX "MindMapEdge_userId_idx" ON "MindMapEdge"("userId");

-- CreateIndex
CREATE INDEX "MindMapEdge_mapId_idx" ON "MindMapEdge"("mapId");

-- CreateIndex
CREATE INDEX "MindMapRevision_userId_idx" ON "MindMapRevision"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "MindMapRevision_mapId_number_key" ON "MindMapRevision"("mapId", "number");

-- CreateIndex
CREATE INDEX "Exercise_userId_idx" ON "Exercise"("userId");

-- CreateIndex
CREATE INDEX "Exercise_subjectId_createdAt_idx" ON "Exercise"("subjectId", "createdAt");

-- CreateIndex
CREATE INDEX "Question_userId_idx" ON "Question"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Question_exerciseId_position_key" ON "Question"("exerciseId", "position");

-- CreateIndex
CREATE INDEX "QuestionConcept_conceptId_idx" ON "QuestionConcept"("conceptId");

-- CreateIndex
CREATE INDEX "ExerciseAttempt_userId_status_idx" ON "ExerciseAttempt"("userId", "status");

-- CreateIndex
CREATE INDEX "ExerciseAttempt_exerciseId_idx" ON "ExerciseAttempt"("exerciseId");

-- CreateIndex
CREATE INDEX "Answer_userId_idx" ON "Answer"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Answer_attemptId_position_key" ON "Answer"("attemptId", "position");

-- CreateIndex
CREATE INDEX "ErrorDiagnosis_userId_conceptId_idx" ON "ErrorDiagnosis"("userId", "conceptId");

-- CreateIndex
CREATE INDEX "ConceptMastery_userId_idx" ON "ConceptMastery"("userId");

-- CreateIndex
CREATE INDEX "LearningActivity_userId_status_updatedAt_idx" ON "LearningActivity"("userId", "status", "updatedAt");

-- CreateIndex
CREATE INDEX "LearningRecommendation_userId_status_idx" ON "LearningRecommendation"("userId", "status");

-- CreateIndex
CREATE INDEX "LabWorkspace_userId_kind_updatedAt_idx" ON "LabWorkspace"("userId", "kind", "updatedAt");

-- CreateIndex
CREATE INDEX "LabRun_userId_idx" ON "LabRun"("userId");

-- CreateIndex
CREATE INDEX "LabRun_workspaceId_createdAt_idx" ON "LabRun"("workspaceId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Document_currentVersionId_key" ON "Document"("currentVersionId");

-- CreateIndex
CREATE INDEX "Document_folderId_idx" ON "Document"("folderId");

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "Folder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_currentVersionId_fkey" FOREIGN KEY ("currentVersionId") REFERENCES "DocumentVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Folder" ADD CONSTRAINT "Folder_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Folder" ADD CONSTRAINT "Folder_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Subject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Folder" ADD CONSTRAINT "Folder_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Folder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentVersion" ADD CONSTRAINT "DocumentVersion_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentVersion" ADD CONSTRAINT "DocumentVersion_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentChunk" ADD CONSTRAINT "DocumentChunk_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentChunk" ADD CONSTRAINT "DocumentChunk_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "DocumentVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentAnalysis" ADD CONSTRAINT "DocumentAnalysis_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentAnalysis" ADD CONSTRAINT "DocumentAnalysis_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "DocumentVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseSection" ADD CONSTRAINT "CourseSection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseSection" ADD CONSTRAINT "CourseSection_analysisId_fkey" FOREIGN KEY ("analysisId") REFERENCES "DocumentAnalysis"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseSection" ADD CONSTRAINT "CourseSection_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "CourseSection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Concept" ADD CONSTRAINT "Concept_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Concept" ADD CONSTRAINT "Concept_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Subject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConceptSource" ADD CONSTRAINT "ConceptSource_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConceptSource" ADD CONSTRAINT "ConceptSource_conceptId_fkey" FOREIGN KEY ("conceptId") REFERENCES "Concept"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConceptSource" ADD CONSTRAINT "ConceptSource_analysisId_fkey" FOREIGN KEY ("analysisId") REFERENCES "DocumentAnalysis"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConceptSource" ADD CONSTRAINT "ConceptSource_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "CourseSection"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConceptRelation" ADD CONSTRAINT "ConceptRelation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConceptRelation" ADD CONSTRAINT "ConceptRelation_fromId_fkey" FOREIGN KEY ("fromId") REFERENCES "Concept"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConceptRelation" ADD CONSTRAINT "ConceptRelation_toId_fkey" FOREIGN KEY ("toId") REFERENCES "Concept"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Note" ADD CONSTRAINT "Note_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Note" ADD CONSTRAINT "Note_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Subject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NoteLink" ADD CONSTRAINT "NoteLink_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NoteLink" ADD CONSTRAINT "NoteLink_noteId_fkey" FOREIGN KEY ("noteId") REFERENCES "Note"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NoteLink" ADD CONSTRAINT "NoteLink_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NoteLink" ADD CONSTRAINT "NoteLink_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "DocumentVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MindMap" ADD CONSTRAINT "MindMap_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MindMap" ADD CONSTRAINT "MindMap_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Subject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MindMap" ADD CONSTRAINT "MindMap_analysisId_fkey" FOREIGN KEY ("analysisId") REFERENCES "DocumentAnalysis"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MindMapNode" ADD CONSTRAINT "MindMapNode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MindMapNode" ADD CONSTRAINT "MindMapNode_mapId_fkey" FOREIGN KEY ("mapId") REFERENCES "MindMap"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MindMapNode" ADD CONSTRAINT "MindMapNode_conceptId_fkey" FOREIGN KEY ("conceptId") REFERENCES "Concept"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MindMapNode" ADD CONSTRAINT "MindMapNode_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "CourseSection"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MindMapEdge" ADD CONSTRAINT "MindMapEdge_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MindMapEdge" ADD CONSTRAINT "MindMapEdge_mapId_fkey" FOREIGN KEY ("mapId") REFERENCES "MindMap"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MindMapEdge" ADD CONSTRAINT "MindMapEdge_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "MindMapNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MindMapEdge" ADD CONSTRAINT "MindMapEdge_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "MindMapNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MindMapRevision" ADD CONSTRAINT "MindMapRevision_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MindMapRevision" ADD CONSTRAINT "MindMapRevision_mapId_fkey" FOREIGN KEY ("mapId") REFERENCES "MindMap"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Exercise" ADD CONSTRAINT "Exercise_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Exercise" ADD CONSTRAINT "Exercise_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Subject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Exercise" ADD CONSTRAINT "Exercise_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Exercise" ADD CONSTRAINT "Exercise_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "DocumentVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Question" ADD CONSTRAINT "Question_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Question" ADD CONSTRAINT "Question_exerciseId_fkey" FOREIGN KEY ("exerciseId") REFERENCES "Exercise"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionConcept" ADD CONSTRAINT "QuestionConcept_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionConcept" ADD CONSTRAINT "QuestionConcept_conceptId_fkey" FOREIGN KEY ("conceptId") REFERENCES "Concept"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExerciseAttempt" ADD CONSTRAINT "ExerciseAttempt_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExerciseAttempt" ADD CONSTRAINT "ExerciseAttempt_exerciseId_fkey" FOREIGN KEY ("exerciseId") REFERENCES "Exercise"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Answer" ADD CONSTRAINT "Answer_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Answer" ADD CONSTRAINT "Answer_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "ExerciseAttempt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErrorDiagnosis" ADD CONSTRAINT "ErrorDiagnosis_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErrorDiagnosis" ADD CONSTRAINT "ErrorDiagnosis_answerId_fkey" FOREIGN KEY ("answerId") REFERENCES "Answer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErrorDiagnosis" ADD CONSTRAINT "ErrorDiagnosis_labRunId_fkey" FOREIGN KEY ("labRunId") REFERENCES "LabRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErrorDiagnosis" ADD CONSTRAINT "ErrorDiagnosis_conceptId_fkey" FOREIGN KEY ("conceptId") REFERENCES "Concept"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConceptMastery" ADD CONSTRAINT "ConceptMastery_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConceptMastery" ADD CONSTRAINT "ConceptMastery_conceptId_fkey" FOREIGN KEY ("conceptId") REFERENCES "Concept"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearningActivity" ADD CONSTRAINT "LearningActivity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearningActivity" ADD CONSTRAINT "LearningActivity_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Subject"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearningRecommendation" ADD CONSTRAINT "LearningRecommendation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearningRecommendation" ADD CONSTRAINT "LearningRecommendation_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Subject"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearningRecommendation" ADD CONSTRAINT "LearningRecommendation_conceptId_fkey" FOREIGN KEY ("conceptId") REFERENCES "Concept"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabWorkspace" ADD CONSTRAINT "LabWorkspace_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabWorkspace" ADD CONSTRAINT "LabWorkspace_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Subject"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabWorkspace" ADD CONSTRAINT "LabWorkspace_exerciseId_fkey" FOREIGN KEY ("exerciseId") REFERENCES "Exercise"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabRun" ADD CONSTRAINT "LabRun_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabRun" ADD CONSTRAINT "LabRun_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "LabWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

