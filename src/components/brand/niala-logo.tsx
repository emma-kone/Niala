import { cn } from "@/lib/utils";

/**
 * Logo de Niala : le nom « Niala » et le symbole « NL », tous deux en MuseoModerno
 * (police chargée dans app/layout.tsx, variable CSS --font-museo).
 */
const BRAND_FONT = { fontFamily: 'var(--font-museo), "Segoe UI", system-ui, sans-serif' } as const;

type Size = "sm" | "md" | "lg";
type Tone = "primary" | "accent";

const MARK_SIZES: Record<Size, string> = {
  sm: "h-7 w-7 rounded-lg text-[13px]",
  md: "h-8 w-8 rounded-xl text-sm",
  lg: "h-14 w-14 rounded-2xl text-2xl shadow-lg",
};

const WORD_SIZES: Record<Size, string> = {
  sm: "text-lg",
  md: "text-xl",
  lg: "text-3xl sm:text-4xl",
};

const TONES: Record<Tone, string> = {
  primary: "bg-primary text-primary-foreground",
  accent: "bg-[var(--niala-accent)] text-[var(--niala-accent-foreground)]",
};

/** Symbole : les lettres NL dans un carré arrondi. */
export function NialaMark({ size = "md", tone = "primary", className }: { size?: Size; tone?: Tone; className?: string }) {
  return (
    <span aria-hidden style={BRAND_FONT} className={cn("inline-flex shrink-0 select-none items-center justify-center font-bold leading-none", MARK_SIZES[size], TONES[tone], className)}>
      NL
    </span>
  );
}

/** Nom : « Niala » en MuseoModerno. `as` permet d'en faire un titre de page. */
export function NialaWordmark({ size = "md", as: Tag = "span", className }: { size?: Size; as?: "span" | "h1"; className?: string }) {
  return (
    <Tag style={BRAND_FONT} className={cn("font-bold leading-none tracking-tight", WORD_SIZES[size], className)}>
      Niala
    </Tag>
  );
}

/** Logo complet : symbole + nom sur une même ligne. */
export function NialaLogo({ size = "md", tone = "primary", wordmarkAs, className }: { size?: Size; tone?: Tone; wordmarkAs?: "span" | "h1"; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-3", className)}>
      <NialaMark size={size} tone={tone} />
      <NialaWordmark size={size} as={wordmarkAs} />
    </span>
  );
}
