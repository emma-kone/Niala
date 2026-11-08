"use client";

import { notify } from "@/components/notifications";

// Adaptateur conservé pour les écrans existants : tout passe par les notifications de l'application
// (en bas à droite, fermables par une croix). « destructive » = erreur, sinon succès.
export interface ToastInput {
  title?: string;
  description?: string;
  variant?: "default" | "destructive";
}

export function toast({ title, description, variant }: ToastInput) {
  return notify({ title, description, variant: variant === "destructive" ? "error" : "success" });
}

export function useToast() {
  return { toast };
}
