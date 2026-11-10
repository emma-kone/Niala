"use client";

import { useCallback, useEffect, useState, type SetStateAction } from "react";
import { useQueryClient } from "@tanstack/react-query";

// ─────────────────────────────────────────────────────────────────────────────
// État « affiché tout de suite, rafraîchi en arrière-plan ». S'utilise comme useState, mais la dernière valeur connue
// est gardée en mémoire (cache React Query de la session) : en revenant sur un module, l'étudiant retrouve aussitôt
// ce qu'il avait sous les yeux, pendant que le chargement habituel du module met les données à jour sans écran d'attente.
// ─────────────────────────────────────────────────────────────────────────────

const ROOT = "ui-cache";

export function useCachedState<T>(key: readonly unknown[], initial: T): [T, (value: SetStateAction<T>) => void] {
  const qc = useQueryClient();
  const keyStr = JSON.stringify(key);
  const read = useCallback(() => qc.getQueryData<{ v: T }>([ROOT, keyStr])?.v ?? initial, [qc, keyStr]);
  const [state, setState] = useState(() => ({ key: keyStr, value: read() }));

  // Changement de clé (autre matière, autre période…) : on repart de la valeur mémorisée pour cette clé.
  let current = state;
  if (state.key !== keyStr) {
    current = { key: keyStr, value: read() };
    setState(current);
  }

  useEffect(() => {
    if (current.value !== initial) qc.setQueryData([ROOT, current.key], { v: current.value });
  }, [qc, current.key, current.value]);

  const set = useCallback(
    (value: SetStateAction<T>) =>
      setState((prev) => ({ key: prev.key, value: typeof value === "function" ? (value as (p: T) => T)(prev.value) : value })),
    []
  );
  return [current.value, set];
}
