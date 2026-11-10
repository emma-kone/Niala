-- Niala : back-office administrateur (rôles, analyse d'usage, demandes des étudiants, audit, communications).
-- Migration purement additive : aucune colonne ni donnée existante n'est supprimée ou modifiée.

ALTER TABLE "public"."User"
  ADD COLUMN "adminRole" TEXT,
  ADD COLUMN "accountStatus" TEXT NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN "statusReason" TEXT,
  ADD COLUMN "statusChangedAt" TIMESTAMP(3),
  ADD COLUMN "actorKey" TEXT;
CREATE UNIQUE INDEX "User_actorKey_key" ON "public"."User"("actorKey");

CREATE TABLE "public"."AnalyticsEvent" (
  "id" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "module" TEXT,
  "actorKey" TEXT NOT NULL,
  "category" TEXT,
  "source" TEXT NOT NULL DEFAULT 'LIVE',
  "sourceRef" TEXT,
  "ok" BOOLEAN NOT NULL DEFAULT true,
  "durationMs" INTEGER,
  "props" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AnalyticsEvent_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AnalyticsEvent_type_sourceRef_key" ON "public"."AnalyticsEvent"("type", "sourceRef");
CREATE INDEX "AnalyticsEvent_createdAt_idx" ON "public"."AnalyticsEvent"("createdAt");
CREATE INDEX "AnalyticsEvent_type_createdAt_idx" ON "public"."AnalyticsEvent"("type", "createdAt");
CREATE INDEX "AnalyticsEvent_actorKey_createdAt_idx" ON "public"."AnalyticsEvent"("actorKey", "createdAt");

CREATE TABLE "public"."RequestLog" (
  "id" TEXT NOT NULL,
  "route" TEXT NOT NULL,
  "method" TEXT NOT NULL,
  "status" INTEGER NOT NULL,
  "durationMs" INTEGER NOT NULL,
  "module" TEXT,
  "errorKind" TEXT,
  "errorSummary" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RequestLog_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "RequestLog_createdAt_idx" ON "public"."RequestLog"("createdAt");
CREATE INDEX "RequestLog_route_createdAt_idx" ON "public"."RequestLog"("route", "createdAt");
CREATE INDEX "RequestLog_errorKind_createdAt_idx" ON "public"."RequestLog"("errorKind", "createdAt");

CREATE TABLE "public"."RoadmapItem" (
  "id" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "status" TEXT NOT NULL DEFAULT 'TO_STUDY',
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RoadmapItem_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "RoadmapItem_status_idx" ON "public"."RoadmapItem"("status");

CREATE TABLE "public"."SupportRequest" (
  "id" TEXT NOT NULL,
  "reference" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "subject" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "module" TEXT,
  "urgency" TEXT,
  "priority" TEXT NOT NULL DEFAULT 'NORMAL',
  "status" TEXT NOT NULL DEFAULT 'RECEIVED',
  "assigneeId" TEXT,
  "roadmapItemId" TEXT,
  "attachments" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "firstReplyAt" TIMESTAMP(3),
  "closedAt" TIMESTAMP(3),
  CONSTRAINT "SupportRequest_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SupportRequest_reference_key" ON "public"."SupportRequest"("reference");
CREATE INDEX "SupportRequest_userId_createdAt_idx" ON "public"."SupportRequest"("userId", "createdAt");
CREATE INDEX "SupportRequest_status_createdAt_idx" ON "public"."SupportRequest"("status", "createdAt");
CREATE INDEX "SupportRequest_roadmapItemId_idx" ON "public"."SupportRequest"("roadmapItemId");
ALTER TABLE "public"."SupportRequest" ADD CONSTRAINT "SupportRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "public"."SupportRequest" ADD CONSTRAINT "SupportRequest_roadmapItemId_fkey" FOREIGN KEY ("roadmapItemId") REFERENCES "public"."RoadmapItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "public"."SupportMessage" (
  "id" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "authorId" TEXT,
  "authorRole" TEXT NOT NULL,
  "authorName" TEXT,
  "internal" BOOLEAN NOT NULL DEFAULT false,
  "body" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SupportMessage_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "SupportMessage_requestId_createdAt_idx" ON "public"."SupportMessage"("requestId", "createdAt");
ALTER TABLE "public"."SupportMessage" ADD CONSTRAINT "SupportMessage_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "public"."SupportRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "public"."AdminAuditLog" (
  "id" TEXT NOT NULL,
  "actorId" TEXT,
  "actorEmail" TEXT,
  "action" TEXT NOT NULL,
  "targetType" TEXT,
  "targetId" TEXT,
  "result" TEXT NOT NULL DEFAULT 'SUCCESS',
  "detail" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AdminAuditLog_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AdminAuditLog_createdAt_idx" ON "public"."AdminAuditLog"("createdAt");
CREATE INDEX "AdminAuditLog_actorId_createdAt_idx" ON "public"."AdminAuditLog"("actorId", "createdAt");
CREATE INDEX "AdminAuditLog_action_createdAt_idx" ON "public"."AdminAuditLog"("action", "createdAt");

-- Le journal est en ajout seul : aucune modification ni suppression, même par l'application.
CREATE OR REPLACE FUNCTION "public"."admin_audit_log_immutable"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'AdminAuditLog est en ajout seul';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "AdminAuditLog_immutable" BEFORE UPDATE OR DELETE ON "public"."AdminAuditLog"
  FOR EACH ROW EXECUTE FUNCTION "public"."admin_audit_log_immutable"();
CREATE TRIGGER "AdminAuditLog_no_truncate" BEFORE TRUNCATE ON "public"."AdminAuditLog"
  FOR EACH STATEMENT EXECUTE FUNCTION "public"."admin_audit_log_immutable"();

CREATE TABLE "public"."AdminSetting" (
  "key" TEXT NOT NULL,
  "value" JSONB NOT NULL,
  "updatedById" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AdminSetting_pkey" PRIMARY KEY ("key")
);

CREATE TABLE "public"."AdminAlert" (
  "id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "severity" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "detail" TEXT,
  "status" TEXT NOT NULL DEFAULT 'OPEN',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolvedAt" TIMESTAMP(3),
  CONSTRAINT "AdminAlert_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AdminAlert_status_createdAt_idx" ON "public"."AdminAlert"("status", "createdAt");
CREATE INDEX "AdminAlert_key_status_idx" ON "public"."AdminAlert"("key", "status");

CREATE TABLE "public"."Announcement" (
  "id" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "audience" JSONB NOT NULL,
  "recipientCount" INTEGER NOT NULL,
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Announcement_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Announcement_createdAt_idx" ON "public"."Announcement"("createdAt");

CREATE TABLE "public"."UserNotification" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "body" TEXT,
  "link" TEXT,
  "refId" TEXT,
  "readAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UserNotification_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "UserNotification_userId_readAt_createdAt_idx" ON "public"."UserNotification"("userId", "readAt", "createdAt");
ALTER TABLE "public"."UserNotification" ADD CONSTRAINT "UserNotification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RLS : l'accès passe par Prisma ; cela bloque l'accès direct via l'API REST publique Supabase.
ALTER TABLE "public"."AnalyticsEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."RequestLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."RoadmapItem" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."SupportRequest" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."SupportMessage" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."AdminAuditLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."AdminSetting" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."AdminAlert" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."Announcement" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."UserNotification" ENABLE ROW LEVEL SECURITY;
