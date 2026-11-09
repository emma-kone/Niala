"use client";

import { isValidElement, useEffect, useRef, useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import { Check, Copy, CornerDownLeft, Loader2, Send, Sparkles } from "lucide-react";
import { ApiError, postStream } from "@/lib/client-api";
import { cn } from "@/lib/utils";
import { confirmAction } from "@/components/notifications";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

// Module d'assistant IA des laboratoires. Il ne dépend que de ses propriétés : le même composant sert
// à l'éditeur de code et au laboratoire SQL, et pourra servir à d'autres espaces de travail.

interface Message {
  role: "user" | "assistant";
  content: string;
  guided?: boolean;
}

interface Props {
  endpoint: string;
  kind: "CODE" | "SQL";
  /** Code affiché dans l'éditeur au moment de la question. */
  getCode: () => string;
  /** L'exercice est en cours : l'assistant guide sans écrire la solution. */
  guided: boolean;
  /** Remplace le contenu de l'éditeur. */
  onInsert: (code: string) => void;
}

const QUICK_ACTIONS = {
  CODE: ["Explique mon code", "Pourquoi ai-je cette erreur ?", "Comment l'améliorer ?", "Quels cas limites tester ?"],
  SQL: ["Explique ma requête", "Pourquoi ai-je cette erreur ?", "Comment l'optimiser ?", "Explique-moi ce schéma"],
};

function textOf(node: ReactNode): string {
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map(textOf).join("");
  return isValidElement<{ children?: ReactNode }>(node) ? textOf(node.props.children) : "";
}

function CodeBlock({ children, onInsert }: { children: ReactNode; onInsert?: (code: string) => void }) {
  const [copied, setCopied] = useState(false);
  const code = textOf(children).replace(/\n$/, "");
  return (
    <div className="overflow-hidden rounded-lg border bg-background">
      <div className="flex justify-end gap-1 border-b px-1.5 py-1">
        <Button type="button" variant="ghost" size="sm" className="h-6 gap-1 px-2 text-[11px]" onClick={() => { void navigator.clipboard.writeText(code).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }); }}>
          {copied ? <Check className="h-3 w-3" aria-hidden /> : <Copy className="h-3 w-3" aria-hidden />} {copied ? "Copié" : "Copier"}
        </Button>
        {onInsert && (
          <Button type="button" variant="ghost" size="sm" className="h-6 gap-1 px-2 text-[11px]" onClick={() => onInsert(code)}>
            <CornerDownLeft className="h-3 w-3" aria-hidden /> Insérer
          </Button>
        )}
      </div>
      <pre className="max-h-72 overflow-auto p-2 font-code text-xs">{children}</pre>
    </div>
  );
}

export function LabAssistantPanel({ endpoint, kind, getCode, guided, onInsert }: Props) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [live, setLive] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const busy = live !== null;

  useEffect(() => {
    end.current?.scrollIntoView({ block: "nearest" });
  }, [messages, live]);

  async function insert(code: string) {
    if (await confirmAction("Remplacer le contenu de l'éditeur par ce code ?", { confirmLabel: "Remplacer", danger: false })) onInsert(code);
  }

  async function send(text: string) {
    const message = text.trim();
    if (!message || busy) return;
    const history = messages.slice(-12).map(({ role, content }) => ({ role, content }));
    setMessages((m) => [...m, { role: "user", content: message }]);
    setInput("");
    setError(null);
    setLive("");
    try {
      const r = await postStream<{ text: string; guided: boolean }>(endpoint, { message, code: getCode(), history }, { status: () => undefined, delta: (d) => setLive((l) => (l ?? "") + d) });
      setMessages((m) => [...m, { role: "assistant", content: r.text, guided: r.guided }]);
    } catch (e) {
      setError(e instanceof ApiError || e instanceof Error ? e.message : "Envoi impossible.");
    } finally {
      setLive(null);
    }
  }

  const markdown = (content: string, canInsert: boolean) => (
    <div className="space-y-2 break-words text-sm leading-relaxed [&_code]:font-code [&_li]:ml-4 [&_ol]:list-decimal [&_p_code]:rounded [&_p_code]:bg-muted [&_p_code]:px-1 [&_ul]:list-disc">
      <ReactMarkdown skipHtml components={{ pre: ({ children }) => <CodeBlock onInsert={canInsert ? (c) => void insert(c) : undefined}>{children}</CodeBlock> }}>{content}</ReactMarkdown>
    </div>
  );

  return (
    <div className="flex h-[480px] flex-col">
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1" aria-live="polite">
        {messages.length === 0 && live === null && (
          <div className="py-4 text-center">
            <Sparkles className="mx-auto h-6 w-6 text-muted-foreground" aria-hidden />
            <p className="mt-2 text-sm font-medium">Assistant IA du laboratoire</p>
            <p className="mx-auto mt-1 max-w-sm text-xs text-muted-foreground">{guided ? "Exercice en cours : l'assistant vous guide sans écrire la solution." : "Il voit votre code et votre dernier résultat. Il peut expliquer, corriger et proposer du code."}</p>
            <div className="mt-3 flex flex-wrap justify-center gap-1.5">
              {QUICK_ACTIONS[kind].map((q) => (
                <button key={q} type="button" onClick={() => void send(q)} className="rounded-full border px-3 py-1 text-xs hover:bg-muted">{q}</button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}>
            <div className={cn("max-w-[92%] rounded-2xl px-3 py-2", m.role === "user" ? "bg-primary text-sm text-primary-foreground" : "bg-muted/60")}>
              {m.role === "user" ? <p className="whitespace-pre-wrap break-words">{m.content}</p> : markdown(m.content, !m.guided)}
            </div>
          </div>
        ))}
        {live !== null && (live ? <div className="max-w-[92%] rounded-2xl bg-muted/60 px-3 py-2">{markdown(live, false)}</div> : <p className="flex items-center gap-2 text-xs text-muted-foreground" role="status"><Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> L&apos;assistant lit votre code…</p>)}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <div ref={end} />
      </div>
      <form className="mt-3 flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); void send(input); }}>
        <Textarea
          aria-label="Question à l'assistant"
          rows={2}
          maxLength={2000}
          value={input}
          placeholder={kind === "SQL" ? "Posez une question sur votre requête…" : "Posez une question sur votre code…"}
          className="min-h-0 resize-none text-sm"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(input); } }}
        />
        <Button type="submit" size="icon" className="h-9 w-9 shrink-0" disabled={busy || !input.trim()} aria-label="Envoyer">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Send className="h-4 w-4" aria-hidden />}
        </Button>
      </form>
      <p className="mt-1.5 text-[11px] text-muted-foreground">Ce que dit l&apos;assistant reste à vérifier en exécutant votre code. Cette discussion n&apos;est pas conservée.</p>
    </div>
  );
}
