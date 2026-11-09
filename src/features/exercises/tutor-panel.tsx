"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { HelpCircle, Lightbulb, ListOrdered, Loader2, MessageCircleQuestion, Send, Sparkles, SearchCheck, BookOpen, type LucideIcon } from "lucide-react";
import { api } from "@/lib/client-api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useSettings, type UserSettings } from "@/features/settings/use-settings";

const RichText = dynamic(() => import("./rich-text"), { loading: () => <Skeleton className="h-4 w-full" /> });

type Kind = "hint" | "explain" | "clarify" | "why_wrong" | "correction" | "steps" | "free";
interface TutorMessage {
  id: string;
  role: "USER" | "ASSISTANT";
  kind: Kind;
  content: string;
}
interface TutorState {
  messages: TutorMessage[];
  allowed: Kind[];
  revealed: boolean;
  assistance: "full" | "hints" | "none";
  aiAvailable: boolean;
}

const ACTIONS: { kind: Kind; label: string; icon: LucideIcon }[] = [
  { kind: "hint", label: "Un indice", icon: Lightbulb },
  { kind: "clarify", label: "Clarifier la consigne", icon: HelpCircle },
  { kind: "explain", label: "Expliquer la notion", icon: BookOpen },
  { kind: "why_wrong", label: "Pourquoi c'est faux ?", icon: SearchCheck },
  { kind: "steps", label: "Les étapes", icon: ListOrdered },
  { kind: "correction", label: "Correction détaillée", icon: Sparkles },
];

/** Tuteur d'une question : il guide sans donner la réponse tant que la question n'est pas corrigée (contrôlé côté serveur). */
export function TutorPanel({ attemptId, position, answer, className }: { attemptId: string; position: number; answer: unknown; className?: string }) {
  const qc = useQueryClient();
  const key = ["tutor", attemptId, position];
  const { data, isLoading, error } = useQuery({ queryKey: key, queryFn: () => api.get<TutorState>(`/api/attempts/${attemptId}/tutor?position=${position}`), staleTime: 0 });
  const { settings, save } = useSettings();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState<Kind | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    end.current?.scrollIntoView({ block: "nearest" });
  }, [data?.messages.length, busy]);

  async function ask(kind: Kind, text?: string) {
    setBusy(kind);
    setProblem(null);
    try {
      qc.setQueryData(key, await api.post<TutorState>(`/api/attempts/${attemptId}/tutor`, { position, kind, message: text, answer }));
      if (text) setMessage("");
    } catch (e) {
      setProblem(e instanceof Error ? e.message : "Le tuteur n'a pas pu répondre.");
    } finally {
      setBusy(null);
    }
  }

  if (isLoading) return <div className={cn("rounded-3xl border bg-card p-4", className)} aria-busy><Skeleton className="h-24 w-full rounded-2xl" /></div>;
  if (error || !data) return <p className={cn("rounded-3xl border bg-card p-4 text-sm text-muted-foreground", className)} role="status">Le tuteur est indisponible pour le moment.</p>;
  if (data.allowed.length === 0) {
    return <p className={cn("rounded-3xl border bg-card p-4 text-sm text-muted-foreground", className)} role="status">Mode examen : l&apos;assistance reprendra une fois la correction disponible.</p>;
  }

  const canWrite = data.allowed.includes("free");
  return (
    <aside aria-label="Tuteur" className={cn("flex max-h-[calc(100dvh-7rem)] flex-col rounded-3xl border bg-card", className)}>
      <header className="flex items-center justify-between gap-2 border-b px-4 py-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold"><MessageCircleQuestion className="h-4 w-4" aria-hidden /> Tuteur · question {position}</h2>
        {settings && (
          <Select value={settings.explanationLevel} onValueChange={(v) => void save({ explanationLevel: v as UserSettings["explanationLevel"] })}>
            <SelectTrigger aria-label="Niveau des explications" className="h-7 w-auto gap-1 rounded-full px-2.5 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="simple">Simple</SelectItem>
              <SelectItem value="standard">Standard</SelectItem>
              <SelectItem value="detailed">Approfondi</SelectItem>
            </SelectContent>
          </Select>
        )}
      </header>

      <div className="min-h-24 flex-1 space-y-3 overflow-y-auto p-4" aria-live="polite">
        {data.messages.length === 0 && <p className="text-sm text-muted-foreground">{data.revealed ? "Revenez sur votre réponse : je peux détailler la correction et chaque étape." : "Bloqué ? Je vous guide pas à pas, sans vous donner la réponse."}</p>}
        {data.messages.map((m) =>
          m.role === "USER" ? (
            <p key={m.id} className="ml-6 rounded-2xl bg-primary/10 px-3 py-2 text-sm">{m.content}</p>
          ) : (
            <RichText key={m.id} text={m.content} className="text-sm leading-relaxed" />
          ),
        )}
        {busy && <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status"><Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Le tuteur réfléchit…</p>}
        <div ref={end} />
      </div>

      <div className="space-y-2 border-t p-3">
        {!data.aiAvailable && <p className="text-xs text-muted-foreground">Le service d&apos;IA est indisponible.</p>}
        <div className="flex flex-wrap gap-1.5">
          {ACTIONS.filter((a) => data.allowed.includes(a.kind)).map((a) => (
            <Button key={a.kind} type="button" variant="outline" size="sm" className="h-7 gap-1 rounded-full px-2.5 text-xs" disabled={!!busy || !data.aiAvailable} onClick={() => void ask(a.kind)}>
              <a.icon className="h-3 w-3" aria-hidden /> {a.label}
            </Button>
          ))}
        </div>
        {canWrite && (
          <form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); if (message.trim()) void ask("free", message.trim()); }}>
            <Textarea aria-label="Votre question au tuteur" rows={1} maxLength={2000} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Posez votre question…" className="min-h-9 resize-none" onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); if (message.trim() && !busy) void ask("free", message.trim()); } }} />
            <Button type="submit" size="icon" aria-label="Envoyer" disabled={!!busy || !message.trim() || !data.aiAvailable}><Send className="h-4 w-4" aria-hidden /></Button>
          </form>
        )}
        {problem && <p role="alert" className="text-xs text-destructive">{problem}</p>}
      </div>
    </aside>
  );
}
