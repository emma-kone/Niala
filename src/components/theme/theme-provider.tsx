"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useSyncExternalStore } from "react";

// ─────────────────────────────────────────────────────────────────────────────
// Thème de Niala : celui du SYSTÈME par défaut (clair ou sombre selon l'appareil), appliqué dès le premier chargement.
//  1. THEME_INIT_SCRIPT (dans <head>, avant le premier rendu) lit la préférence mémorisée localement
//     et pose la classe « dark » : aucun flash clair, aucune dépendance à la page des réglages.
//  2. Le fournisseur reste synchronisé avec la préférence ENREGISTRÉE sur le serveur (prioritaire sur
//     la valeur par défaut) et offre `useTheme` aux composants (éditeurs, notifications).
// ─────────────────────────────────────────────────────────────────────────────

export type ThemeChoice = "light" | "dark" | "system";
export const DEFAULT_THEME: ThemeChoice = "system";
const STORAGE_KEY = "niala-theme";
const EVENT = "niala-theme-change";

export const THEME_INIT_SCRIPT = `try{var t=localStorage.getItem("${STORAGE_KEY}");if(t!=="light"&&t!=="dark"&&t!=="system")t="${DEFAULT_THEME}";var d=t==="dark"||(t==="system"&&window.matchMedia("(prefers-color-scheme: dark)").matches);var e=document.documentElement;e.classList.toggle("dark",d);e.style.colorScheme=d?"dark":"light"}catch(_){}`;

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
const subscribeNothing = () => () => undefined;
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

  const remember = useCallback((value: ThemeChoice) => {
    try {
      localStorage.setItem(STORAGE_KEY, value);
    } catch {
      /* stockage indisponible : le thème s'applique quand même pour cette session */
    }
    window.dispatchEvent(new Event(EVENT));
  }, []);

  // Seul un changement demandé par l'étudiant est accompagné d'un fondu.
  const fade = useRef(false);
  const setTheme = useCallback((value: ThemeChoice) => {
    fade.current = true;
    remember(value);
  }, [remember]);

  // Pendant l'hydratation, le thème vaut encore celui du rendu serveur : le script d'initialisation a déjà posé le bon.
  const hydrated = useSyncExternalStore(subscribeNothing, () => true, () => false);
  const latest = useRef(resolvedTheme);
  useEffect(() => {
    latest.current = resolvedTheme;
    if (!hydrated) return;
    const root = document.documentElement;
    // Le thème appliqué est relu au moment du changement : deux bascules rapprochées ne peuvent pas s'inverser.
    const apply = () => {
      root.classList.toggle("dark", latest.current === "dark");
      root.style.colorScheme = latest.current;
    };
    const changed = root.classList.contains("dark") !== (resolvedTheme === "dark");
    const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // Fondu entre les deux thèmes : le navigateur compose l'ancien et le nouvel état, sans image intermédiaire.
    if (changed && fade.current && !calm && typeof document.startViewTransition === "function") document.startViewTransition(apply);
    else apply();
    fade.current = false;
  }, [resolvedTheme, hydrated]);

  // La préférence enregistrée du compte l'emporte sur la valeur locale (autre appareil, navigateur neuf).
  // Sans session (page de connexion), la requête échoue en silence : on garde le thème par défaut.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/settings", { credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : null))
      .then((body: { settings?: { theme?: unknown } } | null) => {
        const server = body?.settings?.theme;
        if (!cancelled && isThemeChoice(server) && server !== readTheme()) remember(server);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [remember]);

  const value = useMemo(() => ({ theme, resolvedTheme, setTheme }), [theme, resolvedTheme, setTheme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme doit être utilisé dans <ThemeProvider>.");
  return ctx;
}
