import { z } from "zod";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { checkPasswordAsync, getCurrentUser, setSessionCookie } from "@/lib/auth";
import { durableCount, durableHit, durableReset } from "@/lib/rate-limit";
import { clientIp, handle, jsonError, limitDurable, readJson } from "@/lib/api-helpers";
import { track } from "@/server/analytics/track";

/** Échecs tolérés pour un même compte depuis une même adresse, puis pour un même compte toutes adresses confondues. */
const FAIL_WINDOW = 15 * 60_000;
const MAX_FAILS_PER_SOURCE = 10;
const MAX_FAILS_PER_ACCOUNT = 50;

const loginSchema = z.object({
  email: z.string().email("Adresse e-mail invalide"),
  // Longueur bornée : hacher un mot de passe de plusieurs mégaoctets immobiliserait le serveur.
  password: z.string().min(1, "Mot de passe requis").max(200, "Mot de passe trop long."),
});

export async function POST(req: Request) {
  return handle(async () => {
    // Limites propres au client : un inconnu ne peut plus bloquer la connexion des autres étudiants.
    const ip = clientIp(req);
    // Compteurs en base : communs à toutes les instances du serveur, donc impossibles à contourner en changeant d'instance.
    await limitDurable(`login:ip:${ip}`, 30, 60_000);
    const body = await readJson<unknown>(req);
    const { email: rawEmail, password } = loginSchema.parse(body);
    const email = rawEmail.toLowerCase().trim();
    const sourceKey = `login:fail:${email}:${ip}`;
    const accountKey = `login:fail:${email}`;
    const [sourceFails, accountFails] = await Promise.all([durableCount(sourceKey), durableCount(accountKey)]);
    if (sourceFails >= MAX_FAILS_PER_SOURCE || accountFails >= MAX_FAILS_PER_ACCOUNT) {
      return jsonError("Trop de tentatives pour ce compte. Patientez quelques minutes ou utilisez « Mot de passe oublié ».", 429);
    }
    const user = await db.user.findUnique({ where: { email } });
    // Le hachage est calculé même pour une adresse inconnue : le temps de réponse ne révèle pas quels comptes existent.
    if (!(await checkPasswordAsync(password, user?.passwordHash)) || !user) {
      await Promise.all([durableHit(sourceKey, FAIL_WINDOW), durableHit(accountKey, FAIL_WINDOW)]);
      return jsonError("E-mail ou mot de passe incorrect.", 401);
    }
    if (user.accountStatus !== "ACTIVE") {
      await durableReset(sourceKey);
      return jsonError(user.accountStatus === "SUSPENDED" ? "Ce compte est suspendu. Contactez l'équipe Niala pour en savoir plus." : "Ce compte a été désactivé. Contactez l'équipe Niala pour en savoir plus.", 403);
    }
    // Deux écritures indépendantes, lancées ensemble : remise à zéro du compteur d'échecs, et préférences créées dès la
    // connexion (valeurs par défaut Niala : thème sombre…). La version de session vient du compte déjà lu.
    await Promise.all([durableReset(sourceKey), db.userSettings.upsert({ where: { userId: user.id }, create: { userId: user.id }, update: {} })]);
    await setSessionCookie(user.id, user.sessionVersion);
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
