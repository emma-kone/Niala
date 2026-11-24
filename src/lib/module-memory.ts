"use client";

import { useSyncExternalStore } from "react";

// Quand l'étudiant change de module (Agenda, Exercices…) avec un cours ouvert, il retrouve ce cours en revenant :
// la dernière vue d'un module est mémorisée pour la session de l'onglet, et effacée quand il referme le cours lui-même.

const KEY = "niala-module-view";
const EVENT = "niala-module-view-change";

type Memory = Record<string, string>;

function read(): Memory {
  try {
    return JSON.parse(sessionStorage.getItem(KEY) ?? "{}") as Memory;
  } catch {
    return {};
  }
}

function write(memory: Memory) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(memory));
  } catch {
    /* stockage indisponible : le module s'ouvrira sur sa page d'accueil */
  }
  window.dispatchEvent(new Event(EVENT));
}

/** Mémorise la vue à rouvrir en revenant dans ce module (chemin interne, avec ses paramètres). */
export function rememberModuleView(moduleHref: string, view: string) {
  if (!view.startsWith("/") || view.startsWith("//")) return;
  const memory = read();
  if (memory[moduleHref] === view) return;
  write({ ...memory, [moduleHref]: view });
}

export function forgetModuleView(moduleHref: string) {
  const memory = read();
  if (!(moduleHref in memory)) return;
  delete memory[moduleHref];
  write(memory);
}

function subscribe(cb: () => void) {
  window.addEventListener(EVENT, cb);
  return () => window.removeEventListener(EVENT, cb);
}

/**
 * Adresse à ouvrir pour un module : sa dernière vue mémorisée quand on arrive d'un autre module,
 * sa page d'accueil sinon (on est déjà dedans, ou rien n'est mémorisé).
 */
export function useModuleHref(moduleHref: string, pathname: string): string {
  const remembered = useSyncExternalStore(
    subscribe,
    () => read()[moduleHref] ?? "",
    () => ""
  );
  const inside = pathname === moduleHref || pathname.startsWith(`${moduleHref}/`);
  return !inside && remembered ? remembered : moduleHref;
}
