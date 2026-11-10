import { z } from "zod";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser, rateCount, rateLimit, rateReset, setSessionCookie, verifyPassword } from "@/lib/auth";
import { clientIp, handle, jsonError, limit, readJson } from "@/lib/api-helpers";
import { track } from "@/server/analytics/track";

/** Échecs tolérés pour un même compte depuis une même adresse, puis pour un même compte toutes adresses confondues. */
const FAIL_WINDOW = 15 * 60_000;
const MAX_FAILS_PER_SOURCE = 10;
const MAX_FAILS_PER_ACCOUNT = 50;

const loginSchema = z.object({
  email: z.string().email("Adresse e-mail invalide"),
  password: z.string().min(1, "Mot de passe requis"),
});

export async function POST(req: Request) {
  return handle(async () => {
    // Limites propres au client : un inconnu ne peut plus bloquer la connexion des autres étudiants.
    const ip = clientIp(req);
    limit(`login:ip:${ip}`, 30, 60_000);
    const body = await readJson<unknown>(req);
    const { email: rawEmail, password } = loginSchema.parse(body);
    const email = rawEmail.toLowerCase().trim();
    const sourceKey = `login:fail:${email}:${ip}`;
    const accountKey = `login:fail:${email}`;
    if (rateCount(sourceKey) >= MAX_FAILS_PER_SOURCE || rateCount(accountKey) >= MAX_FAILS_PER_ACCOUNT) {
      return jsonError("Trop de tentatives pour ce compte. Patientez quelques minutes ou utilisez « Mot de passe oublié ».", 429);
    }
    const user = await db.user.findUnique({ where: { email } });
    if (!user || !verifyPassword(password, user.passwordHash)) {
      rateLimit(sourceKey, MAX_FAILS_PER_SOURCE, FAIL_WINDOW);
      rateLimit(accountKey, MAX_FAILS_PER_ACCOUNT, FAIL_WINDOW);
      return jsonError("E-mail ou mot de passe incorrect.", 401);
    }
    rateReset(sourceKey);
    if (user.accountStatus !== "ACTIVE") {
      return jsonError(user.accountStatus === "SUSPENDED" ? "Ce compte est suspendu. Contactez l'équipe Niala pour en savoir plus." : "Ce compte a été désactivé. Contactez l'équipe Niala pour en savoir plus.", 403);
    }
    // Les préférences existent dès la connexion (valeurs par défaut Niala : thème sombre…)
    await db.userSettings.upsert({ where: { userId: user.id }, create: { userId: user.id }, update: {} });
    await setSessionCookie(user.id);
    track(user.id, "auth.login", { props: { method: "password" } });
    return NextResponse.json({ ok: true, user: { id: user.id, email: user.email, name: user.name } });
  });
}

export async function GET() {
  return handle(async () => {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ authenticated: false });
    return NextResponse.json({ authenticated: true, user: { id: user.id, email: user.email, name: user.name } });
  });
}
