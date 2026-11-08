"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useSyncExternalStore } from "react";

// ─────────────────────────────────────────────────────────────────────────────
// Thème de Niala : CLAIR par défaut, appliqué dès le premier chargement.
//  1. THEME_INIT_SCRIPT (dans <head>, avant le premier rendu) lit la préférence mémorisée localement
//     et pose la classe « dark » : aucun flash clair, aucune dépendance à la page des réglages.
//  2. Le fournisseur reste synchronisé avec la préférence ENREGISTRÉE sur le serveur (prioritaire sur
//     la valeur par défaut) et offre `useTheme` aux composants (éditeurs, notifications).
// ─────────────────────────────────────────────────────────────────────────────

export type ThemeChoice = "light" | "dark" | "system";
export const DEFAULT_THEME: ThemeChoice = "light";
const STORAGE_KEY = "niala-theme";
const EVENT = "niala-theme-change";

export const THEME_INIT_SCRIPT = `try{var t=localStorage.getItem("${STORAGE_KEY}");if(t!=="light"&&t!=="dark"&&t!=="system")t="${DEFAULT_THEME}";var d=t==="dark"||(t==="system"&&window.matchMedia("(prefers-color-scheme: dark)").matches);var e=document.documentElement;e.classList.toggle("dark",d);e.style.colorScheme=d?"dark":"light"}catch(_){document.documentElement.classList.add("dark")}`;

export const isThemeChoice = (v: unknown): v is ThemeChoice => v === "light" || v === "dark" || v === "system";

function readTheme(): ThemeChoice {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return isThemeChoice(v) ? v : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

function subscribeTheme(cb: () => void) {
  window.addEventListener(EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}

function subscribeSystem(cb: () => void) {
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}
const systemPrefersDark = () => window.matchMedia("(prefers-color-scheme: dark)").matches;

interface ThemeContextValue {
  /** Choix de l'utilisateur (ou valeur par défaut). */
  theme: ThemeChoice;
  /** Thème réellement affiché. */
  resolvedTheme: "light" | "dark";
  /** Applique et mémorise localement le thème (l'enregistrement serveur est fait par l'appelant). */
  setTheme: (theme: ThemeChoice) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const theme = useSyncExternalStore(subscribeTheme, readTheme, () => DEFAULT_THEME);
  const prefersDark = useSyncExternalStore(subscribeSystem, systemPrefersDark, () => true);
  const resolvedTheme = theme === "system" ? (prefersDark ? "dark" : "light") : theme;

  const setTheme = useCallback((value: ThemeChoice) => {
    try {
      localStorage.setItem(STORAGE_KEY, value);
    } catch {
      /* stockage indisponible : le thème s'applique quand même pour cette session */
    }
    window.dispatchEvent(new Event(EVENT));
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", resolvedTheme === "dark");
    document.documentElement.style.colorScheme = resolvedTheme;
  }, [resolvedTheme]);

  // La préférence enregistrée du compte l'emporte sur la valeur locale (autre appareil, navigateur neuf).
  // Sans session (page de connexion), la requête échoue en silence : on garde le thème par défaut.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/settings", { credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : null))
      .then((body: { settings?: { theme?: unknown } } | null) => {
        const server = body?.settings?.theme;
        if (!cancelled && isThemeChoice(server) && server !== readTheme()) setTheme(server);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [setTheme]);

  const value = useMemo(() => ({ theme, resolvedTheme, setTheme }), [theme, resolvedTheme, setTheme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme doit être utilisé dans <ThemeProvider>.");
  return ctx;
}
