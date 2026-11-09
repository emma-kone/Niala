import type { MetadataRoute } from "next";

/** Installation de Niala comme application : nom, couleurs et icônes tirées du symbole « NL ». */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Niala — Plateforme d'apprentissage assistée par IA",
    short_name: "Niala",
    description: "Importez vos cours, créez des exercices et progressez avec un accompagnement intelligent.",
    lang: "fr",
    start_url: "/",
    display: "standalone",
    background_color: "#f1eef5",
    theme_color: "#6e51a1",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
