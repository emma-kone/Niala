-- Niala : pièces jointes au chat (documents de cours, fichiers de l'ordinateur, images). Migration ADDITIVE.
ALTER TABLE "public"."ConversationMessage" ADD COLUMN "attachments" JSONB;
