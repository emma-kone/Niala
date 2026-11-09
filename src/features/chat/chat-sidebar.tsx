"use client";

import { useMemo, useState } from "react";
import { Ellipsis, Loader2, MessageSquarePlus, Pencil, Search, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { ConversationDto } from "./types";

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

function groupLabel(iso: string, now: Date) {
  const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOf(now) - startOf(new Date(iso))) / 86_400_000);
  if (days <= 0) return "Aujourd'hui";
  if (days === 1) return "Hier";
  if (days < 7) return "Cette semaine";
  if (days < 30) return "Ce mois-ci";
  return "Plus ancien";
}

interface Props {
  conversations: ConversationDto[] | null;
  activeId: string | null;
  onNew: () => void;
  onOpen: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onRemove: (id: string) => void;
  /** Réglages (recherche web, matière consultée), en bas de la barre. */
  settings: React.ReactNode;
}

export function ChatSidebar({ conversations, activeId, onNew, onOpen, onRename, onRemove, settings }: Props) {
  const [query, setQuery] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null);
  const groups = useMemo(() => {
    const needle = fold(query.trim());
    const now = new Date();
    const out = new Map<string, ConversationDto[]>();
    for (const c of conversations ?? []) {
      if (needle && !fold(c.title).includes(needle)) continue;
      const label = groupLabel(c.updatedAt, now);
      out.set(label, [...(out.get(label) ?? []), c]);
    }
    return [...out];
  }, [conversations, query]);

  return (
    <aside className="flex h-full w-[17rem] shrink-0 flex-col border-r bg-[var(--chat-sidebar)]" aria-label="Historique et réglages">
      <div className="space-y-2 p-3">
        <button type="button" data-close onClick={onNew} className="flex h-10 w-full items-center justify-center gap-2 rounded-2xl rounded-bl-md bg-primary text-sm font-medium text-primary-foreground transition-transform hover:-translate-y-px">
          <MessageSquarePlus className="h-4 w-4" aria-hidden /> Nouvelle conversation
        </button>
        <label className="relative block">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Rechercher" aria-label="Rechercher une conversation" className="h-9 w-full rounded-xl bg-muted/60 pl-8 pr-8 text-sm outline-none transition-colors placeholder:text-muted-foreground focus:bg-muted" />
          {query && (
            <button type="button" aria-label="Effacer la recherche" onClick={() => setQuery("")} className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground">
              <X className="h-3.5 w-3.5" aria-hidden />
            </button>
          )}
        </label>
      </div>

      <nav className="min-h-0 flex-1 overflow-y-auto px-2 pb-2" aria-label="Historique">
        {conversations === null && <Loader2 className="mx-auto mt-3 h-4 w-4 animate-spin text-muted-foreground" aria-label="Chargement" />}
        {conversations?.length === 0 && <p className="px-2 pt-1 text-xs text-muted-foreground">Vos conversations apparaîtront ici.</p>}
        {conversations && conversations.length > 0 && groups.length === 0 && <p className="px-2 pt-1 text-xs text-muted-foreground">Aucune conversation ne correspond.</p>}
        {groups.map(([label, items]) => (
          <section key={label} className="mb-3">
            <h3 className="px-2 pb-1 text-[11px] font-medium text-muted-foreground">{label}</h3>
            <ul className="space-y-px">
              {items.map((c) => {
                const active = c.id === activeId;
                return (
                  <li key={c.id} className={cn("group relative flex items-center rounded-xl text-sm transition-colors", active ? "bg-[color-mix(in_srgb,var(--niala-accent)_20%,transparent)] font-medium" : "hover:bg-muted/60")}>
                    {active && <span aria-hidden className="absolute left-0 top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-full bg-[var(--niala-accent)]" />}
                    {renaming === c.id ? (
                      <input
                        autoFocus
                        defaultValue={c.title}
                        maxLength={100}
                        aria-label="Nouveau titre"
                        className="m-1 min-w-0 flex-1 rounded-lg border bg-background px-2 py-1 text-sm"
                        onBlur={(e) => {
                          setRenaming(null);
                          onRename(c.id, e.target.value);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") e.currentTarget.blur();
                          if (e.key === "Escape") setRenaming(null);
                        }}
                      />
                    ) : (
                      <button type="button" aria-current={active ? "true" : undefined} className="min-w-0 flex-1 truncate py-1.5 pl-3 pr-1 text-left" onClick={() => onOpen(c.id)} title={c.title}>
                        {c.title}
                      </button>
                    )}
                    {renaming !== c.id && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button type="button" aria-label={`Actions pour ${c.title}`} className="mr-1 rounded-md p-1 text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100 data-[state=open]:opacity-100 max-md:opacity-100">
                            <Ellipsis className="h-4 w-4" aria-hidden />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onSelect={() => setRenaming(c.id)}>
                            <Pencil className="mr-2 h-4 w-4" aria-hidden /> Renommer
                          </DropdownMenuItem>
                          <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => onRemove(c.id)}>
                            <Trash2 className="mr-2 h-4 w-4" aria-hidden /> Supprimer
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </nav>

      <div className="border-t p-3">{settings}</div>
    </aside>
  );
}
