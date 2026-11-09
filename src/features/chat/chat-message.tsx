"use client";

import { memo, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { CalendarPlus, Check, Copy, CornerDownRight, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { planHref } from "@/features/agenda/types";
import { ChatMarkdown } from "./chat-markdown";
import { ConsultedNotice, SourceList } from "./chat-sources";
import { ReliabilityPanel } from "./reliability-panel";
import type { ChatCitation, ChatMessageDto } from "./types";

/** Repère de l'assistant dans la conversation : la même sphère que l'accueil, en miniature. */
export function AssistantMark({ className }: { className?: string }) {
  return <span aria-hidden className={cn("niala-orb block h-7 w-7 shrink-0 rounded-full", className)} />;
}

/** Bulle de réflexion : affichée tant que l'IA travaille et qu'aucun texte n'est encore arrivé. */
export function TypingBubble({ status, slow, large }: { status: string; slow: boolean; large: boolean }) {
  const reduced = useReducedMotion();
  const label = slow ? "Cela prend un peu plus de temps que prévu…" : status;
  return (
    <motion.div role="status" aria-label={label || "L'assistant réfléchit"} initial={reduced ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, transition: { duration: 0.18 } }} transition={{ duration: 0.2 }} className="flex items-center gap-3">
      {large && <AssistantMark />}
      <span className="niala-typing" aria-hidden>
        <i />
        <i />
        <i />
      </span>
      <AnimatePresence mode="wait">
        {label && (
          <motion.span key={label} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="text-xs text-muted-foreground">
            {label}
          </motion.span>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function ActionButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick} className="inline-flex h-7 items-center gap-1 rounded-lg px-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
      {children}
    </button>
  );
}

export function UserBubble({ content, large }: { content: string; large: boolean }) {
  return (
    <div className="flex justify-end">
      <div className={cn("niala-bubble-user whitespace-pre-wrap break-words", large ? "max-w-[78%] text-[15px]" : "max-w-[90%] text-sm")}>{content}</div>
    </div>
  );
}

interface AssistantProps {
  m: ChatMessageDto;
  large: boolean;
  isLast: boolean;
  busy: boolean;
  onCitation?: (c: ChatCitation) => void;
  onVerify?: (c: ChatCitation) => void;
  onRegenerate?: () => void;
  onFollowUp?: () => void;
}

function agendaTitle(content: string) {
  return content.split("\n").map((l) => l.replace(/[#*_`>-]/g, "").trim()).find(Boolean) ?? "Travail conseillé par l'assistant";
}

export const AssistantMessage = memo(function AssistantMessage({ m, large, isLast, busy, onCitation, onVerify, onRegenerate, onFollowUp }: AssistantProps) {
  const [copied, setCopied] = useState(false);
  const [focus, setFocus] = useState<{ n: number; nonce: number } | null>(null);
  const citations = m.citations ?? [];
  const copy = () => {
    void navigator.clipboard?.writeText(m.content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  return (
    <div className="flex gap-3">
      {large && <AssistantMark className="mt-0.5" />}
      <div className="min-w-0 flex-1">
        <ChatMarkdown text={m.content} citationNumbers={citations.map((c) => c.n)} onSource={(n) => setFocus((f) => ({ n, nonce: (f?.nonce ?? 0) + 1 }))} />
        {m.consulted?.interrupted && <p className="mt-2 text-xs italic text-muted-foreground">Réponse interrompue : le texte s&apos;arrête ici.</p>}
        <SourceList citations={citations} focus={focus} onCitation={onCitation} onVerify={onVerify} />
        <ReliabilityPanel info={m.consulted} citations={citations} />
        <ConsultedNotice info={m.consulted} />
        <div className="mt-1.5 -ml-1.5 flex flex-wrap items-center gap-0.5">
          <ActionButton label={copied ? "Copié" : "Copier la réponse"} onClick={copy}>
            {copied ? <Check className="h-3.5 w-3.5" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
          </ActionButton>
          {isLast && !busy && onRegenerate && (
            <ActionButton label="Recommencer la réponse" onClick={onRegenerate}>
              <RefreshCw className="h-3.5 w-3.5" aria-hidden />
            </ActionButton>
          )}
          {isLast && !busy && onFollowUp && (
            <ActionButton label="Poser une question complémentaire" onClick={onFollowUp}>
              <CornerDownRight className="h-3.5 w-3.5" aria-hidden /> Question complémentaire
            </ActionButton>
          )}
          <a href={planHref({ title: agendaTitle(m.content), type: "AUTRE" })} data-hint="Créer une tâche à partir de cette réponse" aria-label="Ajouter à l'agenda" className="inline-flex h-7 items-center rounded-lg px-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
            <CalendarPlus className="h-3.5 w-3.5" aria-hidden />
          </a>
        </div>
      </div>
    </div>
  );
});

/** Réponse en cours de rédaction : le texte arrive progressivement, sans actions tant qu'il n'est pas complet. */
export function LiveMessage({ text, large }: { text: string; large: boolean }) {
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.2 }} className="flex gap-3">
      {large && <AssistantMark className="mt-0.5" />}
      <div className="niala-streaming min-w-0 flex-1">
        <ChatMarkdown text={text} />
      </div>
    </motion.div>
  );
}
