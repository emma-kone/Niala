import type { Metadata } from "next";
import { GateForm } from "./gate-form";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Accès restreint", robots: { index: false, follow: false, nocache: true } };

/**
 * Page du code d'accès. Elle n'est servie que par réécriture depuis l'adresse secrète : le proxy répond 404 à tout accès direct
 * à /zz-gate.
 */
export default function GatePage() {
  return <GateForm />;
}
