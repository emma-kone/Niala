"use client";

import { Languages } from "lucide-react";
import { cn } from "@/lib/utils";
import { notify } from "@/components/notifications";
import { useSettings } from "@/features/settings/use-settings";

export type ChatLang = "fr" | "en";

const OPTIONS: { value: ChatLang; short: string; label: string }[] = [
  { value: "fr", short: "FR", label: "Français" },
  { value: "en", short: "EN", label: "English" },
];

/** Langue de discussion avec l'IA, enregistrée sur le compte : l'assistant répond dans cette langue. */
export function useChatLang(): [ChatLang, (lang: ChatLang) => void] {
  const { settings, save } = useSettings();
  const lang: ChatLang = settings?.chatLang === "en" ? "en" : "fr";
  const change = (next: ChatLang) => {
    if (next === lang) return;
    save({ chatLang: next }).catch((e) => notify({ title: "Langue non enregistrée", description: e instanceof Error ? e.message : "", variant: "error" }));
  };
  return [lang, change];
}

export function ChatLanguageSwitch({ value, onChange, className }: { value: ChatLang; onChange: (lang: ChatLang) => void; className?: string }) {
  return (
    <div role="radiogroup" aria-label="Langue de discussion avec l'IA" title="Langue de discussion avec l'IA" className={cn("inline-flex h-8 shrink-0 items-center gap-0.5 rounded-lg border bg-background p-0.5", className)}>
      <Languages className="mx-1 h-3.5 w-3.5 text-muted-foreground" aria-hidden />
      {OPTIONS.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          aria-label={o.label}
          onClick={() => onChange(o.value)}
          className={cn("h-6 rounded-md px-2 text-xs font-medium transition-colors", value === o.value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground")}
        >
          {o.short}
        </button>
      ))}
    </div>
  );
}
