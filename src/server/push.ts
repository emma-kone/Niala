import webpush from "web-push";
import { z } from "zod";
import { db } from "@/lib/db";

// ─────────────────────────────────────────────────────────────────────────────
// Notifications push (navigateur, Android, iPhone avec l'app ajoutée à l'écran d'accueil) : elles arrivent même quand
// Niala n'est pas ouvert. L'étudiant les accepte appareil par appareil. Configuration : VAPID_PUBLIC_KEY,
// VAPID_PRIVATE_KEY, VAPID_SUBJECT (mailto: de contact). Sans configuration, rien n'est envoyé.
// ─────────────────────────────────────────────────────────────────────────────

const keys = () => ({ pub: process.env.VAPID_PUBLIC_KEY?.trim() ?? "", priv: process.env.VAPID_PRIVATE_KEY?.trim() ?? "", subject: process.env.VAPID_SUBJECT?.trim() || "mailto:contact@niala.app" });
export const pushConfigured = () => !!(keys().pub && keys().priv);
export const pushPublicKey = () => (pushConfigured() ? keys().pub : null);

export const subscriptionSchema = z.object({
  endpoint: z.string().url().max(1000),
  keys: z.object({ p256dh: z.string().min(10).max(300), auth: z.string().min(4).max(100) }),
});

export async function saveSubscription(userId: string, raw: unknown, userAgent: string | null) {
  const s = subscriptionSchema.parse(raw);
  // Un même appareil (endpoint) ne peut appartenir qu'à un compte : la dernière connexion l'emporte.
  await db.pushSubscription.upsert({
    where: { endpoint: s.endpoint },
    create: { userId, endpoint: s.endpoint, p256dh: s.keys.p256dh, auth: s.keys.auth, userAgent: userAgent?.slice(0, 160) ?? null },
    update: { userId, p256dh: s.keys.p256dh, auth: s.keys.auth, userAgent: userAgent?.slice(0, 160) ?? null },
  });
  return { ok: true };
}

export async function removeSubscription(userId: string, endpoint: string) {
  await db.pushSubscription.deleteMany({ where: { userId, endpoint } });
  return { ok: true };
}

export interface PushMessage {
  title: string;
  body: string;
  /** Page ouverte au clic (chemin dans Niala). */
  url?: string;
  tag?: string;
}

/** Envoie une notification à tous les appareils des comptes indiqués. Renvoie le nombre de comptes atteints. */
export async function sendPushToUsers(userIds: string[], message: PushMessage): Promise<number> {
  if (!pushConfigured() || !userIds.length) return 0;
  const { pub, priv, subject } = keys();
  webpush.setVapidDetails(subject, pub, priv);
  const reached = new Set<string>();
  const payload = JSON.stringify({ title: message.title, body: message.body.slice(0, 300), url: message.url ?? "/", tag: message.tag });
  for (let i = 0; i < userIds.length; i += 500) {
    const subs = await db.pushSubscription.findMany({ where: { userId: { in: userIds.slice(i, i + 500) } } });
    const gone: string[] = [];
    // Envois par petits groupes pour ne pas ouvrir des milliers de connexions à la fois.
    for (let j = 0; j < subs.length; j += 20) {
      await Promise.all(
        subs.slice(j, j + 20).map(async (s) => {
          try {
            await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 7 * 24 * 3600 });
            reached.add(s.userId);
          } catch (e) {
            const status = (e as { statusCode?: number }).statusCode;
            // Abonnement expiré ou révoqué par l'appareil : on l'oublie.
            if (status === 404 || status === 410) gone.push(s.id);
            else console.error("[push] envoi refusé :", status ?? (e instanceof Error ? e.message : e));
          }
        })
      );
    }
    if (gone.length) await db.pushSubscription.deleteMany({ where: { id: { in: gone } } });
    if (subs.length) await db.pushSubscription.updateMany({ where: { id: { in: subs.map((s) => s.id).filter((id) => !gone.includes(id)) } }, data: { lastUsedAt: new Date() } });
  }
  return reached.size;
}
