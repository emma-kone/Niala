import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";

// ─────────────────────────────────────────────────────────────────────────────
// Journal d'audit : chaque action sensible du back-office y est consignée (qui, quoi, quand, sur quoi, résultat).
// La table est en ajout seul (déclencheur SQL), et le détail ne contient jamais de contenu privé d'utilisateur.
// ─────────────────────────────────────────────────────────────────────────────

export const AUDIT_ACTIONS: Record<string, string> = {
  "admin.login": "Connexion administrateur",
  "admin.login_failed": "Échec de connexion administrateur",
  "admin.logout": "Déconnexion administrateur",
  "access.denied": "Accès refusé",
  "user.view": "Consultation d'une fiche utilisateur",
  "user.update": "Modification d'un compte",
  "user.suspend": "Suspension d'un utilisateur",
  "user.reactivate": "Réactivation d'un utilisateur",
  "user.disable": "Désactivation d'un utilisateur",
  "user.delete": "Suppression d'un compte",
  "admin.role": "Modification d'un rôle d'administration",
  "request.update": "Modification d'une demande",
  "request.reply": "Réponse à un utilisateur",
  "request.note": "Note interne ajoutée",
  "request.group": "Regroupement de demandes",
  "roadmap.update": "Modification de la feuille de route",
  "setting.update": "Modification d'un paramètre",
  "announcement.publish": "Publication d'une annonce",
  "report.export": "Export d'un rapport",
  "data.backfill": "Reconstitution de l'historique",
  "alert.resolve": "Alerte résolue",
};

export interface AuditActor {
  id: string | null;
  email: string | null;
}

export interface AuditInput {
  targetType?: string;
  targetId?: string;
  result?: "SUCCESS" | "DENIED" | "FAILED";
  detail?: Record<string, unknown>;
}

/** Consigne une action. Une panne du journal est signalée dans les logs serveur sans interrompre l'action déjà effectuée. */
export async function audit(actor: AuditActor | null, action: string, input: AuditInput = {}): Promise<void> {
  try {
    await db.adminAuditLog.create({
      data: {
        actorId: actor?.id ?? null,
        actorEmail: actor?.email ?? null,
        action,
        targetType: input.targetType ?? null,
        targetId: input.targetId ?? null,
        result: input.result ?? "SUCCESS",
        detail: (input.detail as Prisma.InputJsonValue | undefined) ?? undefined,
      },
    });
  } catch (e) {
    console.error("[audit] écriture impossible :", e instanceof Error ? e.message : e);
  }
}
