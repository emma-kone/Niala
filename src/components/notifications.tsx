"use client";

import { useSyncExternalStore } from "react";
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";

// ─────────────────────────────────────────────────────────────────────────────
// Notifications de l'application : cartes empilées en bas à droite, chacune fermable par une croix.
// Remplace les alertes du navigateur (window.alert / window.confirm) et les anciens toasts.
//  - notify({ title, description, variant })   : information, disparaît seule (sauf erreur) ;
//  - confirmAction(message, options)          : demande de confirmation, renvoie Promise<boolean>.
// ─────────────────────────────────────────────────────────────────────────────

export type NotificationVariant = "info" | "success" | "warning" | "error";

interface NotificationItem {
  id: number;
  title?: string;
  description?: string;
  variant: NotificationVariant;
  /** Présent pour une demande de confirmation. */
  confirm?: { label: string; cancelLabel: string; danger: boolean; resolve: (ok: boolean) => void };
}

const MAX_VISIBLE = 5;
const AUTO_CLOSE_MS = 6000;

let items: NotificationItem[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const timers = new Map<number, ReturnType<typeof setTimeout>>();

function emit() {
  for (const l of listeners) l();
}

function push(item: Omit<NotificationItem, "id">): number {
  const id = nextId++;
  items = [...items, { ...item, id }];
  // Au-delà de la limite, on retire les plus anciennes notifications simples (jamais une confirmation en attente).
  while (items.length > MAX_VISIBLE) {
    const oldest = items.find((n) => !n.confirm);
    if (!oldest) break;
    dismiss(oldest.id, false);
  }
  emit();
  return id;
}

/** Ferme une notification. Une confirmation fermée par la croix vaut « Annuler ». */
export function dismiss(id: number, notifyListeners = true) {
  const item = items.find((n) => n.id === id);
  if (!item) return;
  clearTimeout(timers.get(id));
  timers.delete(id);
  items = items.filter((n) => n.id !== id);
  item.confirm?.resolve(false);
  if (notifyListeners) emit();
}

export function notify(input: { title?: string; description?: string; variant?: NotificationVariant; durationMs?: number }): number {
  const variant = input.variant ?? "info";
  const id = push({ title: input.title, description: input.description, variant });
  // Les erreurs restent affichées jusqu'à ce que l'utilisateur les ferme.
  const duration = input.durationMs ?? (variant === "error" ? 0 : AUTO_CLOSE_MS);
  if (duration > 0) timers.set(id, setTimeout(() => dismiss(id), duration));
  return id;
}

export function confirmAction(message: string, options: { title?: string; confirmLabel?: string; cancelLabel?: string; danger?: boolean } = {}): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const once = (ok: boolean) => {
      if (settled) return;
      settled = true;
      resolve(ok);
    };
    const id = push({
      title: options.title ?? "Confirmation",
      description: message,
      variant: options.danger === false ? "info" : "warning",
      confirm: { label: options.confirmLabel ?? "Confirmer", cancelLabel: options.cancelLabel ?? "Annuler", danger: options.danger !== false, resolve: once },
    });
    void id;
  });
}

function answer(id: number, ok: boolean) {
  const item = items.find((n) => n.id === id);
  if (!item?.confirm) return;
  item.confirm.resolve(ok);
  dismiss(id);
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const snapshot = () => items;
/** Référence stable : React exige le même objet à chaque lecture de l'instantané serveur. */
const EMPTY: NotificationItem[] = [];
const serverSnapshot = () => EMPTY;

const STYLE: Record<NotificationVariant, { Icon: typeof Info; icon: string; bar: string }> = {
  info: { Icon: Info, icon: "text-primary", bar: "bg-primary" },
  success: { Icon: CheckCircle2, icon: "text-emerald-600 dark:text-emerald-400", bar: "bg-emerald-500" },
  warning: { Icon: AlertTriangle, icon: "text-amber-600 dark:text-amber-400", bar: "bg-amber-500" },
  error: { Icon: XCircle, icon: "text-destructive", bar: "bg-destructive" },
};

/** Zone d'affichage, à placer une seule fois dans la mise en page racine. */
export function Notifications() {
  const list = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  if (!list.length) return null;
  return (
    <section aria-label="Notifications" className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2">
      {list.map((n) => {
        const s = STYLE[n.variant];
        return (
          <div
            key={n.id}
            role={n.confirm ? "alertdialog" : n.variant === "error" ? "alert" : "status"}
            aria-live={n.variant === "error" || n.confirm ? "assertive" : "polite"}
            className="pointer-events-auto relative flex gap-3 overflow-hidden rounded-lg border bg-popover p-4 pr-10 text-popover-foreground shadow-lg animate-in fade-in slide-in-from-bottom-2"
          >
            <span className={cn("absolute inset-y-0 left-0 w-1", s.bar)} aria-hidden />
            <s.Icon className={cn("mt-0.5 h-4 w-4 shrink-0", s.icon)} aria-hidden />
            <div className="min-w-0 flex-1 space-y-1">
              {n.title && <p className="text-sm font-semibold leading-tight">{n.title}</p>}
              {n.description && <p className="whitespace-pre-line text-sm text-muted-foreground">{n.description}</p>}
              {n.confirm && (
                <div className="flex justify-end gap-2 pt-2">
                  <button type="button" className="rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-muted" onClick={() => answer(n.id, false)}>
                    {n.confirm.cancelLabel}
                  </button>
                  <button
                    type="button"
                    autoFocus
                    className={cn("rounded-md px-3 py-1.5 text-xs font-medium", n.confirm.danger ? "bg-destructive text-destructive-foreground hover:bg-destructive/90" : "bg-primary text-primary-foreground hover:bg-primary/90")}
                    onClick={() => answer(n.id, true)}
                  >
                    {n.confirm.label}
                  </button>
                </div>
              )}
            </div>
            <button type="button" aria-label="Fermer la notification" className="absolute right-2 top-2 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground" onClick={() => dismiss(n.id)}>
              <X className="h-4 w-4" aria-hidden />
            </button>
          </div>
        );
      })}
    </section>
  );
}
