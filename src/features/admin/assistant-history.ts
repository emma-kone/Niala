"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

// Historique des conversations de l'assistant IA du back-office. Chaque administrateur retrouve ses conversations (créer,
// reprendre, supprimer) sur le navigateur qu'il utilise : elles sont gardées dans le stockage local, par compte administrateur,
// et jamais envoyées en base. L'historique est donc propre à ce navigateur.

export interface Conversation<M> {
  id: string;
  title: string;
  updatedAt: number;
  messages: M[];
}

type Msg = { role: string; content: string };

export const NEW_TITLE = "Nouvelle conversation";
export const MAX_CONVERSATIONS = 40;
export const MAX_MESSAGES = 80;
const TITLE_MAX = 60;

export const storageKey = (adminId: string) => `niala:admin-assistant:v2:${adminId}`;
const LEGACY_KEY = "niala:admin-assistant";

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

/** Titre tiré de la première question de l'administrateur. */
export function titleOf(messages: Msg[]): string {
  const first = messages.find((m) => m.role === "user")?.content.replace(/\s+/g, " ").trim();
  if (!first) return NEW_TITLE;
  return first.length > TITLE_MAX ? `${first.slice(0, TITLE_MAX - 1).trimEnd()}…` : first;
}

/** Relit l'historique enregistré ; tout ce qui est illisible ou mal formé est ignoré. */
export function parseConversations<M extends Msg>(raw: string | null): Conversation<M>[] {
  if (!raw) return [];
  try {
    const data = JSON.parse(raw) as unknown;
    if (!Array.isArray(data)) return [];
    return data
      .filter((c): c is Conversation<M> => !!c && typeof c === "object" && typeof (c as Conversation<M>).id === "string" && Array.isArray((c as Conversation<M>).messages))
      .map((c) => ({ id: c.id, title: typeof c.title === "string" && c.title ? c.title : titleOf(c.messages), updatedAt: Number(c.updatedAt) || 0, messages: c.messages.filter((m) => m && typeof m.content === "string" && typeof m.role === "string") }))
      .filter((c) => c.messages.length > 0);
  } catch {
    return [];
  }
}

/** Ce qui est conservé : les conversations non vides, les plus récentes d'abord, plafonnées. */
export function pruneConversations<M extends Msg>(items: Conversation<M>[]): Conversation<M>[] {
  return items
    .filter((c) => c.messages.length > 0)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, MAX_CONVERSATIONS)
    .map((c) => ({ ...c, messages: c.messages.slice(-MAX_MESSAGES) }));
}

function readStored<M extends Msg>(adminId: string): Conversation<M>[] {
  try {
    const stored = parseConversations<M>(localStorage.getItem(storageKey(adminId)));
    if (stored.length) return stored;
    // Reprise de l'ancienne conversation unique, qui vivait dans l'onglet.
    const legacy = JSON.parse(sessionStorage.getItem(LEGACY_KEY) ?? "[]") as M[];
    if (Array.isArray(legacy) && legacy.length) return [{ id: uid(), title: titleOf(legacy), updatedAt: Date.now(), messages: legacy }];
  } catch {
    /* stockage indisponible */
  }
  return [];
}

function draft<M>(): Conversation<M> {
  return { id: uid(), title: NEW_TITLE, updatedAt: Date.now(), messages: [] };
}

export function useConversations<M extends Msg>(adminId: string, immediate: boolean) {
  const [state, setState] = useState<{ items: Conversation<M>[]; activeId: string }>(() => {
    const items = immediate ? readStored<M>(adminId).sort((a, b) => b.updatedAt - a.updatedAt) : [];
    return { items, activeId: items[0]?.id ?? "" };
  });
  const { items, activeId } = state;
  const setItems = useCallback((fn: (list: Conversation<M>[]) => Conversation<M>[]) => setState((s) => ({ ...s, items: fn(s.items) })), []);
  const setActiveId = useCallback((id: string) => setState((s) => ({ ...s, activeId: id })), []);
  const [ready, setReady] = useState(immediate);

  // Rendu côté serveur : l'historique n'est relu qu'après l'hydratation.
  useEffect(() => {
    if (immediate) return;
    const t = window.setTimeout(() => {
      const stored = readStored<M>(adminId).sort((a, b) => b.updatedAt - a.updatedAt);
      setState({ items: stored, activeId: stored[0]?.id ?? "" });
      setReady(true);
    }, 0);
    return () => window.clearTimeout(t);
  }, [adminId, immediate]);

  useEffect(() => {
    if (!ready) return;
    try {
      localStorage.setItem(storageKey(adminId), JSON.stringify(pruneConversations(items)));
    } catch {
      /* stockage plein ou indisponible : l'historique reste en mémoire pour cette session */
    }
  }, [items, ready, adminId]);

  // Une conversation vide (brouillon) n'existe que tant qu'elle est ouverte : « Nouvelle conversation » n'en crée jamais deux.
  const sorted = useMemo(() => [...items].sort((a, b) => b.updatedAt - a.updatedAt), [items]);
  const active = items.find((c) => c.id === activeId) ?? null;

  const update = useCallback((id: string, fn: (messages: M[]) => M[]) => {
    setItems((list) => {
      const exists = list.some((c) => c.id === id);
      const base = exists ? list : [{ ...draft<M>(), id }, ...list];
      return base.map((c) => {
        if (c.id !== id) return c;
        const messages = fn(c.messages);
        return { ...c, messages, title: titleOf(messages), updatedAt: Date.now() };
      });
    });
  }, [setItems]);

  /** Identifiant de la conversation ouverte ; en crée une si aucune n'est ouverte. */
  const ensureActive = useCallback((): string => {
    if (active) return active.id;
    const d = draft<M>();
    setItems((list) => [d, ...list]);
    setActiveId(d.id);
    return d.id;
  }, [active, setItems, setActiveId]);

  const startNew = useCallback(() => {
    if (active && active.messages.length === 0) return;
    const d = draft<M>();
    setItems((list) => [d, ...list.filter((c) => c.messages.length > 0)]);
    setActiveId(d.id);
  }, [active, setItems, setActiveId]);

  const select = setActiveId;

  const remove = useCallback(
    (id: string) => {
      setItems((list) => list.filter((c) => c.id !== id));
      if (id === activeId) setActiveId("");
    },
    [activeId, setItems, setActiveId]
  );

  return { items: sorted, active, activeId: active?.id ?? "", messages: active?.messages ?? [], ready, update, ensureActive, startNew, select, remove };
}
