import type { Metadata } from "next";

// Espace d'administration : jamais indexé, ni mis en cache par les navigateurs partagés.
export const metadata: Metadata = {
  title: { default: "Niala — Administration", template: "%s · Niala Administration" },
  robots: { index: false, follow: false, nocache: true },
};

export default function AdminRootLayout({ children }: { children: React.ReactNode }) {
  return children;
}
