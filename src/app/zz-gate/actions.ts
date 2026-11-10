"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { GATE_COOKIE, GATE_MAX_AGE, codeRequired, gateSlug, gateToken } from "@/server/admin/gate";
import { attemptGate } from "@/server/admin/gate-attempt";

export interface GateState { error: string | null }

/** Vérifie le code d'accès ; s'il est bon, dépose le cookie de passage et mène à la connexion administrateur. */
export async function submitAccessCode(_prev: GateState, form: FormData): Promise<GateState> {
  const slug = gateSlug();
  if (!slug || !codeRequired()) return { error: "Accès indisponible." };
  const h = await headers();
  const ip = (h.get("x-forwarded-for") ?? "").split(",")[0]?.trim() || h.get("x-real-ip") || null;
  const result = await attemptGate(String(form.get("code") ?? ""), ip);
  if (!result.ok) {
    // Ralentit les essais en série ; le message ne dit rien de plus que « code incorrect ».
    await new Promise((r) => setTimeout(r, 700));
    return { error: result.reason === "locked" ? "Trop d'essais. Réessayez dans quelques minutes." : "Code incorrect." };
  }
  (await cookies()).set(GATE_COOKIE, gateToken(slug), { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: GATE_MAX_AGE });
  redirect("/admin/login");
}
