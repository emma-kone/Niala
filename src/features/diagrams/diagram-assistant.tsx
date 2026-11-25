"use client";

import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { Check, Loader2, Send, Sparkles, Wand2 } from "lucide-react";
import { ApiError, postStream } from "@/lib/client-api";
import { cn } from "@/lib/utils";
import type { Diagram } from "@/server/domain/diagram";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

// Discussion avec l'assistant du laboratoire de diagrammes. À chaque question, il reçoit le diagramme tel qu'il est
// affiché et la sélection en cours ; il peut répondre par une proposition de diagramme que l'étudiant applique d'un clic
// (et annule avec Ctrl+Z).

interface Message {
  role: "user" | "assistant";
  content: string;
  proposal?: Diagram | null;
  applied?: boolean;
}

interface Props {
  workspaceId: string;
  /** Clé de session : la discussion est retrouvée en revenant au diagramme après avoir changé de module. */
  storageKey?: string;
  kind: Diagram["kind"];
  getDiagram: () => Diagram;
  getSelection: () => string[];
  hasSubject: boolean;
  onApply: (d: Diagram) => void;
}

const QUICK = {
  mcd: ["Construis le MCD à partir du sujet", "Vérifie mon MCD", "Explique les cardinalités de mon schéma", "Donne-moi un indice sans la solution"],
  uml: ["Construis le diagramme à partir du sujet", "Vérifie mon diagramme de classes", "Héritage, composition ou association ici ?", "Donne-moi un indice sans la solution"],
};

function summary(before: Diagram, after: Diagram) {
  const ids = new Set(before.nodes.map((n) => n.id));
  const afterIds = new Set(after.nodes.map((n) => n.id));
  const added = after.nodes.filter((n) => !ids.has(n.id)).length;
  const removed = before.nodes.filter((n) => !afterIds.has(n.id)).length;
  const parts = [`${after.nodes.length} élément(s), ${after.links.length} lien(s)`];
  if (added) parts.push(`${added} ajouté(s)`);
  if (removed) parts.push(`${removed} retiré(s)`);
  return parts.join(" · ");
}

export function DiagramAssistant({ workspaceId, storageKey, kind, getDiagram, getSelection, hasSubject, onApply }: Props) {
  const [messages, setMessages] = useState<Message[]>(() => {
    if (!storageKey) return [];
    try {
      return JSON.parse(sessionStorage.getItem(storageKey) ?? "[]") as Message[];
    } catch {
      return [];
    }
  });
  useEffect(() => {
    if (!storageKey) return;
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(messages.slice(-40)));
    } catch {
      /* stockage plein : la discussion n'est simplement pas gardée */
    }
  }, [messages, storageKey]);
  const [input, setInput] = useState("");
  const [live, setLive] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const busy = live !== null;

  useEffect(() => {
    end.current?.scrollIntoView({ block: "nearest" });
  }, [messages, live]);

  async function send(text: string) {
    const message = text.trim();
    if (!message || busy) return;
    const history = messages.slice(-12).map(({ role, content }) => ({ role, content }));
    setMessages((m) => [...m, { role: "user", content: message }]);
    setInput("");
    setError(null);
    setLive("");
    try {
      const r = await postStream<{ text: string; proposal: Diagram | null }>(`/api/labs/${workspaceId}/diagram-assistant`, { message, diagram: getDiagram(), selection: getSelection(), history }, { status: () => undefined, delta: (d) => setLive((l) => (l ?? "") + d) });
      setMessages((m) => [...m, { role: "assistant", content: r.text, proposal: r.proposal }]);
    } catch (e) {
      setError(e instanceof ApiError || e instanceof Error ? e.message : "Envoi impossible.");
    } finally {
      setLive(null);
    }
  }

  function apply(i: number) {
    const p = messages[i]?.proposal;
    if (!p) return;
    onApply(p);
    setMessages((m) => m.map((x, j) => (j === i ? { ...x, applied: true } : x)));
  }

  const md = (content: string) => (
    <div className="space-y-2 break-words text-sm leading-relaxed [&_code]:font-code [&_li]:ml-4 [&_ol]:list-decimal [&_p_code]:rounded [&_p_code]:bg-muted [&_p_code]:px-1 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-background [&_pre]:p-2 [&_pre]:text-xs [&_table]:text-xs [&_ul]:list-disc">
      <ReactMarkdown skipHtml>{content}</ReactMarkdown>
    </div>
  );

  return (
    <div className="flex h-full min-h-[420px] flex-col">
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1" aria-live="polite">
        {messages.length === 0 && live === null && (
          <div className="py-4 text-center">
            <Sparkles className="mx-auto h-6 w-6 text-muted-foreground" aria-hidden />
            <p className="mt-2 text-sm font-medium">Assistant de modélisation</p>
            <p className="mx-auto mt-1 max-w-sm text-xs text-muted-foreground">Il voit votre diagramme, ce que vous avez sélectionné{hasSubject ? " et le sujet de l'exercice" : ""}. Il explique, vérifie, et peut proposer des modifications que vous appliquez d&apos;un clic.</p>
            <div className="mt-3 flex flex-wrap justify-center gap-1.5">
              {QUICK[kind].filter((q) => hasSubject || !q.includes("sujet")).map((q) => (
                <button key={q} type="button" onClick={() => void send(q)} className="rounded-full border px-3 py-1 text-xs hover:bg-muted">{q}</button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}>
            <div className={cn("max-w-[94%] rounded-2xl px-3 py-2", m.role === "user" ? "bg-primary text-sm text-primary-foreground" : "bg-muted/60")}>
              {m.role === "user" ? <p className="whitespace-pre-wrap break-words">{m.content}</p> : md(m.content)}
              {m.proposal && (
                <div className="mt-2 rounded-lg border bg-background p-2">
                  <p className="text-xs font-medium">Proposition de diagramme</p>
                  <p className="text-[11px] text-muted-foreground">{summary(getDiagram(), m.proposal)}</p>
                  <Button size="sm" className="mt-2 h-7 gap-1 text-xs" disabled={m.applied} onClick={() => apply(i)}>
                    {m.applied ? <Check className="h-3.5 w-3.5" aria-hidden /> : <Wand2 className="h-3.5 w-3.5" aria-hidden />} {m.applied ? "Appliquée (Ctrl+Z pour annuler)" : "Appliquer au diagramme"}
                  </Button>
                </div>
              )}
            </div>
          </div>
        ))}
        {live !== null && (live ? <div className="max-w-[94%] rounded-2xl bg-muted/60 px-3 py-2">{md(live)}</div> : <p className="flex items-center gap-2 text-xs text-muted-foreground" role="status"><Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> L&apos;assistant regarde votre diagramme…</p>)}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <div ref={end} />
      </div>
      <form className="mt-3 flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); void send(input); }}>
        <Textarea
          aria-label="Question à l'assistant"
          rows={2}
          maxLength={2000}
          value={input}
          placeholder="Ex. : ajoute une entité Professeur, ou pourquoi 1,n ici ?"
          className="min-h-0 resize-none text-sm"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(input); } }}
        />
        <Button type="submit" size="icon" className="h-9 w-9 shrink-0" disabled={busy || !input.trim()} aria-label="Envoyer">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Send className="h-4 w-4" aria-hidden />}
        </Button>
      </form>
      <p className="mt-1.5 text-[11px] text-muted-foreground">Une modélisation se discute : vérifiez les propositions avant de les garder. Cette discussion est gardée jusqu&apos;à la fermeture de l&apos;onglet.</p>
    </div>
  );
}
