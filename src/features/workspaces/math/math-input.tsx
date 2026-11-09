"use client";

import { useCallback, useEffect, useRef, useState, type DetailedHTMLProps, type HTMLAttributes } from "react";

// Champ de saisie mathématique (MathLive) : l'étudiant compose ses formules visuellement, sans connaître LaTeX.
// Chaque modification donne le LaTeX (affichage, enregistrement) et la forme « ascii-math » (vérification et tracé).

type MathField = HTMLElement & { value: string; getValue: (format: string) => string; executeCommand: (cmd: [string, string]) => boolean; focus: () => void };
declare module "react" {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface IntrinsicElements {
      "math-field": DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement> & { "math-virtual-keyboard-policy"?: string; placeholder?: string; readonly?: string };
    }
  }
}

type Keyboard = { show: () => void; hide: () => void; visible?: boolean };

let ready: Promise<void> | null = null;
function loadMathLive(): Promise<void> {
  ready ??= import("mathlive").then(({ MathfieldElement }) => {
    // Polices servies par l'application ; aucun son chargé.
    MathfieldElement.fontsDirectory = "/mathlive/fonts";
    MathfieldElement.soundsDirectory = null;
  });
  return ready;
}

/** Dernier champ actif : la palette y insère ses structures. */
let active: MathField | null = null;
export const insertInActiveField = (latex: string) => {
  if (!active) return false;
  active.focus();
  return active.executeCommand(["insert", latex]);
};
export const toggleKeyboard = () => {
  const k = (window as unknown as { mathVirtualKeyboard?: Keyboard }).mathVirtualKeyboard;
  if (!k) return;
  if (k.visible) k.hide();
  else k.show();
};

export function MathInput({ value, onChange, ariaLabel, placeholder, disabled, className }: { value: string; onChange: (latex: string, ascii: string) => void; ariaLabel: string; placeholder?: string; disabled?: boolean; className?: string }) {
  const el = useRef<MathField | null>(null);
  const [ok, setOk] = useState(false);
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  });
  const attach = useCallback((n: HTMLElement | null) => {
    el.current = n as MathField | null;
  }, []);

  useEffect(() => {
    let alive = true;
    void loadMathLive().then(() => alive && setOk(true));
    return () => {
      alive = false;
    };
  }, []);
  useEffect(() => {
    if (ok && el.current && el.current.value !== value) el.current.value = value;
  }, [value, ok]);
  useEffect(() => {
    const node = el.current;
    if (!ok || !node) return;
    const input = () => onChangeRef.current(node.value, node.getValue("ascii-math"));
    const focus = () => { active = node; };
    node.addEventListener("input", input);
    node.addEventListener("focusin", focus);
    return () => {
      node.removeEventListener("input", input);
      node.removeEventListener("focusin", focus);
      if (active === node) active = null;
    };
  }, [ok]);

  return (
    <math-field
      ref={attach}
      aria-label={ariaLabel}
      math-virtual-keyboard-policy="manual"
      placeholder={placeholder}
      readonly={disabled ? "" : undefined}
      className={`block w-full rounded-md border bg-background px-2 py-1 text-base ${className ?? ""}`}
      style={{ minHeight: "2.5rem" }}
    />
  );
}
