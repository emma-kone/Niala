import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiHttpError, handle, limitDurable, readJson } from "@/lib/api-helpers";
import { durableCount, durableHit, durableReset } from "@/lib/rate-limit";
import { audit } from "@/server/admin/audit";
import { loginAdminWithPassword } from "@/server/admin/auth";
import { requestMeta, setAdminCookie, getAdmin } from "@/server/admin/session";
import { landingFor } from "@/server/admin/rbac";

const schema = z.object({ email: z.string().trim().email().max(320), password: z.string().min(1).max(200) });

// Protection contre la force brute. Tous les compteurs sont en base (communs à toutes les instances du serveur) :
//  - 20 tentatives par adresse IP et par 10 minutes, réussies ou non ;
//  - 5 échecs par adresse IP, ou 10 échecs pour un même compte toutes adresses confondues : verrouillage de 15 minutes ;
//  - chaque échec est ralenti, et consigné dans le journal d'audit (les verrouillages aussi).
// Les messages restent identiques quel que soit le motif : rien n'indique si l'adresse appartient à un administrateur.
const LOCK_WINDOW = 15 * 60_000;
const MAX_FAILS_PER_IP = 5;
const MAX_FAILS_PER_ACCOUNT = 10;
const FAIL_DELAY_MS = 800;
const LOCKED = "Trop de tentatives. Réessayez dans 15 minutes.";

export async function POST(req: Request) {
  return handle(async () => {
    const meta = await requestMeta();
    const ip = meta.ip ?? "?";
    await limitDurable(`admin-login:ip:${ip}`, 20, 10 * 60_000);
    const { email: rawEmail, password } = schema.parse(await readJson<unknown>(req));
    const email = rawEmail.toLowerCase();
    const ipKey = `admin-login:fail:ip:${ip}`;
    const accountKey = `admin-login:fail:${email}`;
    const [ipFails, accountFails] = await Promise.all([durableCount(ipKey), durableCount(accountKey)]);
    if (ipFails >= MAX_FAILS_PER_IP || accountFails >= MAX_FAILS_PER_ACCOUNT) {
      await audit({ id: null, email }, "admin.login_failed", { targetType: "admin", result: "DENIED", detail: { reason: "locked", ip: meta.ip } });
      throw new ApiHttpError(LOCKED, 429);
    }
    try {
      const result = await loginAdminWithPassword(email, password, meta);
      await Promise.all([durableReset(ipKey), durableReset(accountKey)]);
      await setAdminCookie(result.userId, result.version);
      return NextResponse.json({ ok: true, landing: result.landing });
    } catch (err) {
      if (err instanceof ApiHttpError && err.status === 401) {
        await Promise.all([durableHit(ipKey, LOCK_WINDOW), durableHit(accountKey, LOCK_WINDOW)]);
        await new Promise((r) => setTimeout(r, FAIL_DELAY_MS));
      }
      throw err;
    }
  });
}

export async function GET() {
  return handle(async () => {
    const admin = await getAdmin();
    return admin ? { authenticated: true, landing: landingFor(admin.role) } : { authenticated: false };
  });
}
