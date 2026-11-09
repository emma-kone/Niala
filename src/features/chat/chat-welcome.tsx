"use client";

import { useMemo } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Bug, FileText, GraduationCap, ListChecks, type LucideIcon, ScrollText, Sparkles } from "lucide-react";
import { SubjectIcon } from "@/components/subject-icon";
import { useAppStore } from "@/store/app-store";
import type { RecentDoc } from "./chat-composer";

export interface Suggestion {
  title: string;
  prompt: string;
  /** Documents réellement concernés : ils sont pris comme contexte de la question. */
  documents?: RecentDoc[];
  icon?: LucideIcon;
}

const QUICK_ACTIONS: { label: string; icon: LucideIcon; template: string }[] = [
  { label: "Expliquer", icon: GraduationCap, template: "Explique-moi comme à un débutant : " },
  { label: "Fiche de révision", icon: ScrollText, template: "Crée une fiche de révision sur : " },
  { label: "Exercices", icon: ListChecks, template: "Génère trois exercices corrigés à partir de mes documents sur : " },
  { label: "Erreur de code", icon: Bug, template: "Aide-moi à comprendre cette erreur dans mon code :\n" },
];

const GENERIC: Suggestion[] = [
  { title: "Explique-moi une notion comme à un débutant", prompt: "Explique-moi une notion importante de mes cours comme à un débutant, avec un exemple." },
  { title: "Quels sujets mes documents abordent-ils ?", prompt: "Quels sujets mes documents abordent-ils ?" },
  { title: "Compare les notions communes à mes cours", prompt: "Compare les notions communes à plusieurs de mes cours." },
];

/** Suggestions tirées des derniers cours réellement ouverts ; à défaut, des questions générales sur la bibliothèque. */
function buildSuggestions(recent: RecentDoc[]): Suggestion[] {
  if (!recent.length) return GENERIC;
  const [first] = recent;
  const other = recent.find((d) => d.subjectId !== first.subjectId);
  const out: Suggestion[] = [{ title: `Résume « ${first.name} »`, prompt: `Résume le document « ${first.name} » en points clés.`, documents: [first] }];
  if (other) out.push({ title: `Compare ${first.subjectName} et ${other.subjectName}`, prompt: `Compare les notions abordées dans « ${first.name} » et « ${other.name} » : points communs et différences.`, documents: [first, other] });
  else out.push({ title: `Crée une fiche de révision de ${first.subjectName}`, prompt: `Crée une fiche de révision à partir de « ${first.name} ».`, documents: [first] });
  out.push({ title: `Interroge-moi sur ${first.subjectName}`, prompt: `Pose-moi trois questions pour vérifier ce que j'ai compris de « ${first.name} », une à la fois.`, documents: [first] });
  return out;
}

function greeting(firstName: string) {
  const hour = new Date().getHours();
  const hello = hour >= 18 || hour < 5 ? "Bonsoir" : "Bonjour";
  return firstName ? `${hello} ${firstName}` : hello;
}

function subline(recent: RecentDoc[]) {
  if (recent[0]) return `On continue avec ${recent[0].subjectName} ?`;
  return "Sur quoi travaillons-nous aujourd'hui ?";
}

const rise = { hidden: { opacity: 0, y: 10 }, show: { opacity: 1, y: 0 } };

/** Écran d'accueil d'une conversation vide : présentation, zone de saisie, actions rapides et suggestions contextualisées. */
export function ChatWelcome({ recent, disabled, composer, onSuggestion, onQuickAction }: { recent: RecentDoc[]; disabled: boolean; composer: React.ReactNode; onSuggestion: (s: Suggestion) => void; onQuickAction: (template: string) => void }) {
  const name = useAppStore((s) => s.user?.name?.trim().split(/\s+/)[0] ?? "");
  const suggestions = useMemo(() => buildSuggestions(recent), [recent]);
  const reduced = useReducedMotion();
  const motionProps = reduced ? {} : { variants: rise, initial: "hidden", animate: "show" };
  const delay = (n: number) => (reduced ? undefined : { delay: n * 0.06, duration: 0.3 });
  return (
    <div className="mx-auto flex min-h-full w-full max-w-2xl flex-col justify-center px-4 py-8">
      <motion.div {...motionProps} transition={delay(0)} className="flex flex-col items-center text-center">
        <span aria-hidden className="niala-orb niala-orb-float mb-5 block h-16 w-16 rounded-full" />
        <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground"><Sparkles className="h-3 w-3" aria-hidden /> Niala AI</p>
        <h2 className="mt-1 text-3xl font-bold tracking-tight">{greeting(name)}</h2>
        <p className="mt-1 text-lg text-muted-foreground">{subline(recent)}</p>
      </motion.div>
      <motion.div {...motionProps} transition={delay(1)} className="mt-6">
        {composer}
      </motion.div>
      <motion.ul {...motionProps} transition={delay(2)} className="mt-3 flex flex-wrap justify-center gap-1.5" aria-label="Actions rapides">
        {QUICK_ACTIONS.map((a) => (
          <li key={a.label}>
            <button type="button" disabled={disabled} onClick={() => onQuickAction(a.template)} className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50">
              <a.icon className="h-3.5 w-3.5" aria-hidden /> {a.label}
            </button>
          </li>
        ))}
      </motion.ul>
      <motion.ul {...motionProps} transition={delay(3)} className="mt-6 grid gap-2 sm:grid-cols-3" aria-label="Suggestions">
        {suggestions.map((s) => {
          const doc = s.documents?.[0];
          return (
            <li key={s.title}>
              <button type="button" disabled={disabled} onClick={() => onSuggestion(s)} className="flex h-full w-full flex-col gap-2 rounded-2xl rounded-tl-md bg-card p-3.5 text-left text-sm font-medium leading-snug transition-transform hover:-translate-y-0.5 disabled:opacity-50">
                {doc ? <SubjectIcon icon={doc.subjectIcon} name={doc.subjectName} color={doc.subjectColor} /> : <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-muted"><FileText className="h-3.5 w-3.5" aria-hidden /></span>}
                <span className="line-clamp-3 break-words">{s.title}</span>
              </button>
            </li>
          );
        })}
      </motion.ul>
    </div>
  );
}
