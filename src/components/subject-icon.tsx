"use client";

import {
  Atom, BadgeDollarSign, Binary, BookMarked, BrainCircuit, BriefcaseBusiness, Calculator, ChartColumn, Clapperboard, Cloud, CodeXml, Cpu, Database, Dna, Dumbbell, Earth, FlaskConical, Globe, IterationCw, Landmark, Languages, Lightbulb, type LucideIcon, Megaphone, MessagesSquare, Music, Network, Palette, Rocket, Scale, ScrollText, ShieldCheck, Sigma, Smartphone, SquareKanban, Stethoscope, Users, Workflow,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { resolveSubjectIcon, type SubjectIconId } from "@/server/domain/subject-icon";
import { BRAND_ICONS, type BrandIconId } from "./subject-brand-icons";

const THEME_ICONS: Record<Exclude<SubjectIconId, BrandIconId>, { icon: LucideIcon; label: string }> = {
  code: { icon: CodeXml, label: "Programmation" },
  web: { icon: Globe, label: "Web" },
  mobile: { icon: Smartphone, label: "Mobile" },
  diagram: { icon: Workflow, label: "Diagrammes" },
  agile: { icon: IterationCw, label: "Méthodes agiles" },
  project: { icon: SquareKanban, label: "Gestion de projet" },
  startup: { icon: Rocket, label: "Entrepreneuriat" },
  business: { icon: BriefcaseBusiness, label: "Entreprise" },
  database: { icon: Database, label: "Bases de données" },
  network: { icon: Network, label: "Réseaux" },
  security: { icon: ShieldCheck, label: "Sécurité" },
  system: { icon: Cpu, label: "Systèmes" },
  cloud: { icon: Cloud, label: "Cloud" },
  ai: { icon: BrainCircuit, label: "Intelligence artificielle" },
  algorithm: { icon: Binary, label: "Algorithmique" },
  math: { icon: Sigma, label: "Mathématiques" },
  statistics: { icon: ChartColumn, label: "Statistiques" },
  physics: { icon: Atom, label: "Physique" },
  chemistry: { icon: FlaskConical, label: "Chimie" },
  biology: { icon: Dna, label: "Biologie" },
  medicine: { icon: Stethoscope, label: "Santé" },
  law: { icon: Scale, label: "Droit" },
  economics: { icon: BadgeDollarSign, label: "Économie" },
  accounting: { icon: Calculator, label: "Comptabilité" },
  marketing: { icon: Megaphone, label: "Marketing" },
  management: { icon: Users, label: "Management" },
  communication: { icon: MessagesSquare, label: "Communication" },
  languages: { icon: Languages, label: "Langues" },
  literature: { icon: ScrollText, label: "Littérature" },
  history: { icon: Landmark, label: "Histoire" },
  geography: { icon: Earth, label: "Géographie" },
  philosophy: { icon: Lightbulb, label: "Philosophie" },
  psychology: { icon: BrainCircuit, label: "Psychologie" },
  design: { icon: Palette, label: "Design" },
  multimedia: { icon: Clapperboard, label: "Multimédia" },
  music: { icon: Music, label: "Musique" },
  sport: { icon: Dumbbell, label: "Sport" },
  generic: { icon: BookMarked, label: "Matière" },
};

const isBrand = (id: SubjectIconId): id is BrandIconId => id in BRAND_ICONS;

export const subjectIconLabel = (id: SubjectIconId) => (isBrand(id) ? BRAND_ICONS[id].title : THEME_ICONS[id].label);

/** Icônes proposées au choix manuel, thèmes d'abord. */
export const SUBJECT_ICON_CHOICES = [...(Object.keys(THEME_ICONS) as SubjectIconId[]), ...(Object.keys(BRAND_ICONS) as SubjectIconId[])];

const SIZES = { xs: "h-5 w-5 rounded-md", sm: "h-7 w-7 rounded-lg", md: "h-10 w-10 rounded-xl", lg: "h-12 w-12 rounded-2xl" } as const;
const GLYPH = { xs: "h-3 w-3", sm: "h-3.5 w-3.5", md: "h-5 w-5", lg: "h-6 w-6" } as const;

/** Glyphe seul : logo aux couleurs officielles, ou icône de thème dans la couleur demandée. */
export function SubjectGlyph({ id, color, className }: { id: SubjectIconId; color?: string; className?: string }) {
  if (isBrand(id)) {
    const brand = BRAND_ICONS[id];
    return (
      <svg viewBox="0 0 24 24" aria-hidden className={className} fill={brand.color}>
        <path d={brand.path} />
      </svg>
    );
  }
  const Icon = THEME_ICONS[id].icon;
  return <Icon aria-hidden className={className} style={color ? { color } : undefined} />;
}

/**
 * Représentation unique d'une matière dans toute l'application : pastille teintée par la couleur de la matière,
 * avec son icône enregistrée. La couleur reste celle de la matière ; un logo garde ses couleurs officielles.
 */
export function SubjectIcon({ icon, name, color, size = "sm", surface = "theme", className }: { icon?: string | null; name: string; color: string; size?: keyof typeof SIZES; /** « pastel » : posée sur un fond clair quel que soit le thème. */ surface?: "theme" | "pastel"; className?: string }) {
  const id = resolveSubjectIcon(icon, name);
  const brand = isBrand(id);
  const background = brand ? "var(--brand-chip)" : surface === "pastel" ? "rgb(255 255 255 / 0.72)" : `color-mix(in srgb, ${color} 22%, transparent)`;
  const glyph = surface === "pastel" ? `color-mix(in srgb, ${color} 75%, black)` : `color-mix(in srgb, ${color} 70%, var(--foreground))`;
  return (
    <span aria-hidden data-subject-icon={id} className={cn("inline-flex shrink-0 items-center justify-center", SIZES[size], brand && "ring-1 ring-black/5", className)} style={{ background }}>
      <SubjectGlyph id={id} className={GLYPH[size]} color={brand ? undefined : glyph} />
    </span>
  );
}
