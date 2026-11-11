"use client";

import { useEffect, useState } from "react";
import { Switch } from "@/components/ui/switch";
import { notify } from "@/components/notifications";
import { api } from "@/lib/client-api";

// Abonnement de CET appareil aux notifications push de Niala (annonces de l'équipe, même site fermé).

type State = "loading" | "unsupported" | "unconfigured" | "denied" | "off" | "on";

const supported = () => typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

/** Clé publique VAPID (base64url) → tableau d'octets attendu par le navigateur. */
function toBytes(key: string): Uint8Array<ArrayBuffer> {
  const pad = "=".repeat((4 - (key.length % 4)) % 4);
  const raw = atob((key + pad).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function currentSubscription() {
  const reg = await navigator.serviceWorker.getRegistration("/sw.js");
  return reg ? reg.pushManager.getSubscription() : null;
}

export function PushDeviceToggle() {
  const [state, setState] = useState<State>("loading");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!supported()) return setState("unsupported");
      const { publicKey } = await api.get<{ publicKey: string | null }>("/api/push").catch(() => ({ publicKey: null }));
      if (cancelled) return;
      if (!publicKey) return setState("unconfigured");
      if (Notification.permission === "denied") return setState("denied");
      setState((await currentSubscription()) ? "on" : "off");
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function enable() {
    const { publicKey } = await api.get<{ publicKey: string | null }>("/api/push");
    if (!publicKey) return setState("unconfigured");
    const permission = await Notification.requestPermission();
    if (permission !== "granted") return setState(permission === "denied" ? "denied" : "off");
    const reg = await navigator.serviceWorker.register("/sw.js");
    await navigator.serviceWorker.ready;
    const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toBytes(publicKey) }));
    await api.post("/api/push", sub.toJSON());
    setState("on");
    notify({ title: "Notifications activées sur cet appareil", variant: "success" });
  }

  async function disable() {
    const sub = await currentSubscription();
    if (sub) {
      await api.request("DELETE", "/api/push", { endpoint: sub.endpoint }).catch(() => undefined);
      await sub.unsubscribe().catch(() => undefined);
    }
    setState("off");
  }

  async function change(on: boolean) {
    setBusy(true);
    try {
      await (on ? enable() : disable());
    } catch (e) {
      notify({ title: "Réglage impossible", description: e instanceof Error ? e.message : "Réessayez.", variant: "error" });
    } finally {
      setBusy(false);
    }
  }

  const hint: Partial<Record<State, string>> = {
    unsupported: "Ce navigateur ne prend pas en charge les notifications. Sur iPhone, ajoutez d'abord Niala à l'écran d'accueil (Partager → Sur l'écran d'accueil).",
    unconfigured: "Les notifications sur appareil ne sont pas encore disponibles.",
    denied: "Les notifications sont bloquées pour Niala dans les réglages du navigateur : autorisez-les puis revenez ici.",
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <Switch id="setting-push-device" checked={state === "on"} disabled={busy || state === "loading" || state === "unsupported" || state === "unconfigured" || state === "denied"} onCheckedChange={(v) => void change(v)} aria-label="Notifications sur cet appareil" />
      {hint[state] && <p className="max-w-xs text-right text-xs text-muted-foreground">{hint[state]}</p>}
    </div>
  );
}
