-- Niala : conversations avec l'IA (globales et par document) et vecteurs sémantiques des passages.
-- Migration ADDITIVE : aucune donnée existante n'est modifiée ni supprimée.

CREATE TYPE "public"."ConversationScope" AS ENUM ('GLOBAL', 'DOCUMENT');
CREATE TYPE "public"."ChatRole" AS ENUM ('USER', 'ASSISTANT');

ALTER TABLE "public"."DocumentChunk" ADD COLUMN "embedding" DOUBLE PRECISION[] DEFAULT ARRAY[]::DOUBLE PRECISION[];
ALTER TABLE "public"."DocumentChunk" ADD COLUMN "embeddingModel" TEXT;

CREATE TABLE "public"."Conversation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "scope" "public"."ConversationScope" NOT NULL,
    "documentId" TEXT,
    "subjectId" TEXT,
    "title" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "public"."ConversationMessage" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "role" "public"."ChatRole" NOT NULL,
    "content" TEXT NOT NULL,
    "citations" JSONB,
    "consulted" JSONB,
    "model" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ConversationMessage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Conversation_userId_scope_updatedAt_idx" ON "public"."Conversation"("userId", "scope", "updatedAt");
CREATE INDEX "Conversation_documentId_idx" ON "public"."Conversation"("documentId");
CREATE INDEX "ConversationMessage_conversationId_createdAt_idx" ON "public"."ConversationMessage"("conversationId", "createdAt");

ALTER TABLE "public"."Conversation" ADD CONSTRAINT "Conversation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "public"."Conversation" ADD CONSTRAINT "Conversation_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "public"."Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "public"."Conversation" ADD CONSTRAINT "Conversation_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "public"."Subject"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "public"."ConversationMessage" ADD CONSTRAINT "ConversationMessage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "public"."ConversationMessage" ADD CONSTRAINT "ConversationMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "public"."Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RLS : l'accès applicatif passe par Prisma (rôle propriétaire) ; cela bloque l'API REST publique Supabase.
ALTER TABLE "public"."Conversation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."ConversationMessage" ENABLE ROW LEVEL SECURITY;
