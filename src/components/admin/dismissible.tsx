"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

// Messages d'information du back-office que l'administrateur peut effacer. L'effacement est mémorisé dans ce navigateur
// (clé = empreinte du texte du message) : un constat qui change de contenu réapparaît, un constat identique reste masqué.

const STORAGE_KEY = "niala:admin:dismissed-notices";
const EVENT = "niala:admin-notices";
const MAX_KEPT = 300;

function parse(raw: string): string[] {
  try {
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function read(): string[] {
  try {
    return parse(localStorage.getItem(STORAGE_KEY) ?? "");
  } catch {
    return [];
  }
}

function write(list: string[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list.slice(-MAX_KEPT)));
  } catch {
    /* stockage indisponible : le message réapparaîtra au prochain chargement */
  }
  window.dispatchEvent(new Event(EVENT));
}

/** Empreinte courte et stable d'un texte (djb2). */
export function fingerprint(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

function snapshot(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}
function subscribe(cb: () => void) {
  window.addEventListener(EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}
function useDismissed(): string[] {
  const raw = useSyncExternalStore(subscribe, snapshot, () => "");
  return useMemo(() => parse(raw), [raw]);
}

/** Réaffiche tous les messages effacés. */
export function resetDismissedNotices() {
  write([]);
}

export function DismissibleNotice({ className, children, dismissKey }: { className?: string; children: React.ReactNode; dismissKey?: string }) {
  const dismissed = useDismissed();
  const ref = useRef<HTMLDivElement | null>(null);
  const [key, setKey] = useState<string | null>(dismissKey ?? null);

  // Sans clé explicite, l'empreinte est calculée sur le texte réellement affiché.
  useEffect(() => {
    if (dismissKey) return;
    const text = ref.current?.textContent?.trim();
    if (text) setKey(fingerprint(text));
  }, [dismissKey, children]);

  if (key && dismissed.includes(key)) return null;
  return (
    <div ref={ref} role="note" className={cn("relative", className)}>
      {children}
      {key && (
        <button
          type="button"
          onClick={() => write([...read().filter((k) => k !== key), key])}
          aria-label="Effacer ce message"
          title="Effacer ce message"
          className="absolute right-2 top-2 rounded-md p-1 text-muted-foreground transition hover:bg-black/10 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--niala-accent)]"
        >
          <X className="h-3.5 w-3.5" aria-hidden />
        </button>
      )}
    </div>
  );
}
