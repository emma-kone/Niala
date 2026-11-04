import { z } from "zod";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser, setSessionCookie, verifyPassword } from "@/lib/auth";
import { handle, jsonError, limit, readJson } from "@/lib/api-helpers";

const loginSchema = z.object({
  email: z.string().email("Adresse e-mail invalide"),
  password: z.string().min(1, "Mot de passe requis"),
});

export async function POST(req: Request) {
  return handle(async () => {
    // Limites par adresse IP ET par compte : une clé globale permettrait à quiconque de bloquer tous les comptes.
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "inconnue";
    limit(`login:ip:${ip}`, 30, 60_000);
    const body = await readJson<unknown>(req);
    const { email, password } = loginSchema.parse(body);
    limit(`login:email:${email.toLowerCase().trim()}`, 10, 60_000);
    const user = await db.user.findUnique({ where: { email: email.toLowerCase().trim() } });
    if (!user || !verifyPassword(password, user.passwordHash)) {
      return jsonError("E-mail ou mot de passe incorrect.", 401);
    }
    // Les préférences existent dès la connexion (valeurs par défaut Niala : thème sombre…)
    await db.userSettings.upsert({ where: { userId: user.id }, create: { userId: user.id }, update: {} });
    await setSessionCookie(user.id);
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
