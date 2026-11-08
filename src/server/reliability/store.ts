import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import type { VerifiableSource, VerificationReport } from "./claims";

// Conservation d'une vérification : sources consultées, extraits, affirmations, preuves, dates et limites.
// Au mieux : un échec d'enregistrement ne doit jamais empêcher l'étudiant de recevoir sa réponse.

export interface SavedSource extends VerifiableSource {
  documentId?: string;
  page?: number | null;
  organization?: string | null;
  publishedAt?: string | null;
  retrievedAt: string;
}

const json = (v: unknown) => v as Prisma.InputJsonValue;

export async function saveVerification(userId: string, target: { feature: string; entityType: string; entityId: string }, report: VerificationReport, sources: SavedSource[]): Promise<void> {
  try {
    // Identifiants créés ici pour tout écrire en quatre requêtes groupées : sur une base distante,
    // une requête par ligne dépasse le délai d'une transaction.
    const runId = randomUUID();
    const sourceRows = sources.map((s) => ({ id: randomUUID(), runId, n: s.n, kind: s.kind, title: s.title.slice(0, 300), url: s.url ?? null, host: s.host ?? null, organization: s.organization ?? null, documentId: s.documentId ?? null, page: s.page ?? null, level: s.level ?? null, sourceKind: s.sourceKind ?? null, publishedAt: s.publishedAt ?? null, excerpt: s.text.slice(0, 4000), retrievedAt: new Date(s.retrievedAt) }));
    const sourceId = new Map(sourceRows.map((s) => [s.n, s.id]));
    const claimRows = report.claims.map((c) => ({ id: randomUUID(), runId, text: c.text, claimType: c.type, domain: c.domain, confidence: c.confidence, basis: c.basis, reason: c.reason, limits: json(c.limits), courseConflict: c.courseConflict }));
    const evidenceRows = report.claims.flatMap((c, i) => c.evidence.filter((e) => sourceId.has(e.n)).map((e) => ({ claimId: claimRows[i].id, sourceId: sourceId.get(e.n)!, stance: e.stance, quote: e.quote, direct: e.direct })));

    await db.$transaction([
      db.verificationRun.create({ data: { id: runId, userId, ...target, status: report.status, webStatus: report.webStatus, summary: json(report.summary), limits: json(report.limits), rejectedCitations: report.rejectedCitations, checkedAt: new Date(report.checkedAt) } }),
      db.sourceSnapshot.createMany({ data: sourceRows }),
      db.claim.createMany({ data: claimRows }),
      db.claimEvidence.createMany({ data: evidenceRows }),
    ]);
  } catch (e) {
    console.warn("[reliability] enregistrement impossible :", e instanceof Error ? e.message : e);
  }
}
