"use client";

import dynamic from "next/dynamic";

// Le jeton se lit dans le fragment (#) de l'adresse, qui n'existe que dans le navigateur : rendu côté client uniquement.
export const ResetPasswordGate = dynamic(() => import("@/features/auth/password-reset-view").then((m) => m.ResetPasswordView), { ssr: false });
