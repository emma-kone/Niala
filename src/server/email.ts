// ─────────────────────────────────────────────────────────────────────────────
// Envoi d'e-mails (Resend). Configuration : RESEND_API_KEY + EMAIL_FROM (ex. « Niala <equipe@niala.app> », domaine vérifié
// chez Resend). Sans configuration, aucun e-mail ne part : les fonctionnalités restent utilisables dans le site et
// l'appelant est prévenu (résultat `false`).
// La clé n'apparaît jamais dans un message d'erreur ni un journal.
// ─────────────────────────────────────────────────────────────────────────────

export const emailConfigured = () => !!(process.env.RESEND_API_KEY?.trim() && process.env.EMAIL_FROM?.trim());

export interface Email {
  to: string;
  subject: string;
  text: string;
  html?: string;
  /** En-têtes supplémentaires (ex. List-Unsubscribe pour les annonces). */
  headers?: Record<string, string>;
}

const ENDPOINT = "https://api.resend.com";

async function post(path: string, body: unknown): Promise<void> {
  const res = await fetch(`${ENDPOINT}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`envoi refusé (${res.status})`);
}

const payload = (e: Email) => ({ from: process.env.EMAIL_FROM, to: e.to, subject: e.subject, text: e.text, ...(e.html ? { html: e.html } : {}), ...(e.headers ? { headers: e.headers } : {}) });

/** Envoie un e-mail ; lève une erreur si l'envoi est refusé. À n'appeler que si `emailConfigured()`. */
export async function sendEmail(e: Email): Promise<void> {
  await post("/emails", payload(e));
}

/** Envoie un e-mail sans jamais lever d'erreur : renvoie `true` s'il est parti. */
export async function trySendEmail(e: Email, context: string): Promise<boolean> {
  if (!emailConfigured()) return false;
  try {
    await sendEmail(e);
    return true;
  } catch (err) {
    console.error(`[email] ${context} : non envoyé :`, err instanceof Error ? err.message : err);
    return false;
  }
}

/** Envoi groupé (100 e-mails par appel chez Resend). Renvoie le nombre d'e-mails acceptés. */
export async function sendEmailBatch(emails: Email[], context: string): Promise<number> {
  if (!emailConfigured() || !emails.length) return 0;
  let sent = 0;
  for (let i = 0; i < emails.length; i += 100) {
    const chunk = emails.slice(i, i + 100);
    try {
      await post("/emails/batch", chunk.map(payload));
      sent += chunk.length;
    } catch (err) {
      console.error(`[email] ${context} : lot ${i / 100 + 1} non envoyé :`, err instanceof Error ? err.message : err);
    }
    // Resend limite le débit : courte pause entre deux lots.
    if (i + 100 < emails.length) await new Promise((r) => setTimeout(r, 600));
  }
  return sent;
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Mise en page simple et sobre d'un e-mail Niala (texte échappé, un bouton facultatif, un pied de page facultatif). */
export function emailHtml(opts: { title: string; paragraphs: string[]; button?: { label: string; url: string }; footer?: string }): string {
  const p = opts.paragraphs.map((t) => `<p style="margin:0 0 14px;line-height:1.55">${escapeHtml(t).replace(/\n/g, "<br>")}</p>`).join("");
  const btn = opts.button ? `<p style="margin:22px 0"><a href="${escapeHtml(opts.button.url)}" style="background:#1c1530;color:#fff;text-decoration:none;padding:11px 18px;border-radius:10px;display:inline-block;font-weight:600">${escapeHtml(opts.button.label)}</a></p>` : "";
  const foot = opts.footer ? `<p style="margin:26px 0 0;font-size:12px;color:#6b6478;line-height:1.5">${opts.footer}</p>` : "";
  return `<!doctype html><html lang="fr"><body style="margin:0;background:#f4f1f8;padding:24px;font-family:Segoe UI,Arial,sans-serif;color:#1f1a2b"><div style="max-width:560px;margin:0 auto;background:#fff;border-radius:16px;padding:28px"><p style="margin:0 0 18px;font-weight:700;font-size:18px;color:#1c1530">Niala</p><h1 style="font-size:19px;margin:0 0 16px">${escapeHtml(opts.title)}</h1>${p}${btn}${foot}</div></body></html>`;
}
