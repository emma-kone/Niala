import type { Metadata } from "next";
import { LandingPage } from "@/features/landing/landing-page";

export const metadata: Metadata = {
  title: "Niala — vos cours, un assistant IA et votre progression",
  description: "Niala range vos cours, vous explique ce que vous ne comprenez pas, génère des exercices corrigés à partir de vos documents et mesure votre progression, notion par notion.",
  openGraph: { title: "Niala — l'espace d'étude des étudiants", description: "Cours, assistant IA, exercices corrigés, cartes mentales, agenda et progression au même endroit.", images: ["/accueil/tableau-de-bord.webp"] },
};

export default function WelcomePage() {
  return <LandingPage />;
}
