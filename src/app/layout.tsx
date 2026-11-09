import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, JetBrains_Mono, MuseoModerno } from "next/font/google";
import "./globals.css";
import { Notifications } from "@/components/notifications";
import { ThemeProvider, THEME_INIT_SCRIPT } from "@/components/theme/theme-provider";

/**
 * ── TYPOGRAPHIE GLOBALE NIALA ─────────────────────────────────────────
 * Police principale : Bricolage Grotesque (importée depuis Google Fonts via
 * next/font — auto-hébergée, zéro décalage de mise en page, fallback ajusté
 * automatiquement, `font-display: swap`).
 * Police de code : JetBrains Mono (éditeurs, console, zones SQL).
 * Police du logo : MuseoModerno, réservée au nom « Niala » et au symbole « NL »
 * (composants de src/components/brand).
 * ──────────────────────────────────────────────────────────────────────────────
 */
const bricolageGrotesque = Bricolage_Grotesque({
  variable: "--font-bricolage",
  subsets: ["latin"],
  axes: ["opsz", "wdth"],
  display: "swap",
  fallback: ["Segoe UI", "system-ui", "Arial", "sans-serif"],
  adjustFontFallback: true,
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains",
  subsets: ["latin"],
  display: "swap",
  fallback: ["ui-monospace", "Menlo", "Consolas", "monospace"],
});

const museoModerno = MuseoModerno({
  variable: "--font-museo",
  subsets: ["latin"],
  display: "swap",
  fallback: ["Segoe UI", "system-ui", "Arial", "sans-serif"],
});

export const metadata: Metadata = {
  title: "Niala — Plateforme d'apprentissage assistée par IA",
  description:
    "Importez vos cours, générez des exercices personnalisés, codez et pratiquez le SQL, suivez votre progression. Plateforme personnelle d'apprentissage assistée par intelligence artificielle.",
  applicationName: "Niala",
  appleWebApp: { title: "Niala", capable: true, statusBarStyle: "default" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f1eef5" },
    { media: "(prefers-color-scheme: dark)", color: "#261839" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="fr"
      suppressHydrationWarning
      className={`${bricolageGrotesque.variable} ${jetbrainsMono.variable} ${museoModerno.variable}`}
    >
      <head>
        {/* Thème appliqué avant le premier rendu : clair par défaut, sans flash */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="antialiased bg-background text-foreground">
        <ThemeProvider>
          {children}
          <Notifications />
        </ThemeProvider>
      </body>
    </html>
  );
}
