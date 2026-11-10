"use client";

import { useEffect, useRef } from "react";

// ─────────────────────────────────────────────────────────────────────────────
// Rafraîchissement intelligent, en arrière-plan : les données d'un module sont relues sans recharger la page ni
// afficher d'écran d'attente (l'affichage précédent reste en place jusqu'à la réponse).
//   • au retour sur l'onglet ou sur la fenêtre (une modification faite ailleurs apparaît aussitôt) ;
//   • au retour de la connexion réseau ;
//   • à intervalle régulier, seulement si l'onglet est affiché (aucune requête inutile en arrière-plan) ;
//   • quand un autre onglet de Niala signale un changement (`announceDataChanged`).
// Un délai minimal évite les relectures en rafale ; `enabled: false` suspend tout (saisie ou sélection en cours).
// ─────────────────────────────────────────────────────────────────────────────

const CHANNEL = "niala-data";

export interface BackgroundRefreshOptions {
  /** Relecture périodique quand l'onglet est visible (0 = jamais). Par défaut 60 s. */
  intervalMs?: number;
  /** Délai minimal entre deux relectures déclenchées par le focus ou le réseau. Par défaut 10 s. */
  minGapMs?: number;
  /** Faux pendant une saisie, une sélection ou un glisser-déposer : rien n'est relu. */
  enabled?: boolean;
  /** Sujets écoutés sur le canal entre onglets (ex. "agenda"). */
  topics?: string[];
}

/** Signale aux autres onglets ouverts que des données ont changé (ils les relisent en arrière-plan). */
export function announceDataChanged(topic: string) {
  try {
    const channel = new BroadcastChannel(CHANNEL);
    channel.postMessage({ topic });
    channel.close();
  } catch {
    // BroadcastChannel indisponible : les autres onglets se mettront à jour au retour du focus.
  }
}

export function useBackgroundRefresh(refresh: () => unknown, { intervalMs = 60_000, minGapMs = 10_000, enabled = true, topics = [] }: BackgroundRefreshOptions = {}) {
  const refreshRef = useRef(refresh);
  const enabledRef = useRef(enabled);
  const last = useRef(0);
  useEffect(() => {
    refreshRef.current = refresh;
    enabledRef.current = enabled;
  });
  const topicKey = topics.join(",");

  useEffect(() => {
    last.current = Date.now(); // le module vient de charger ses données
    const run = (force = false) => {
      if (!enabledRef.current || document.visibilityState !== "visible") return;
      const now = Date.now();
      if (!force && now - last.current < minGapMs) return;
      last.current = now;
      void Promise.resolve(refreshRef.current()).catch(() => undefined);
    };
    const onVisible = () => run();
    const onFocus = () => run();
    const onOnline = () => run(true);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onFocus);
    window.addEventListener("online", onOnline);
    const timer = intervalMs > 0 ? setInterval(() => run(true), intervalMs) : null;

    let channel: BroadcastChannel | null = null;
    const wanted = topicKey ? topicKey.split(",") : [];
    try {
      if (wanted.length) {
        channel = new BroadcastChannel(CHANNEL);
        channel.onmessage = (e: MessageEvent<{ topic?: string }>) => {
          if (e.data?.topic && wanted.includes(e.data.topic)) run(true);
        };
      }
    } catch {
      channel = null;
    }
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("online", onOnline);
      if (timer) clearInterval(timer);
      channel?.close();
    };
  }, [intervalMs, minGapMs, topicKey]);
}
