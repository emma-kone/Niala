import { LegalShell } from "@/components/legal/legal-document";

// Pages publiques : accessibles sans compte (Google et les visiteurs doivent pouvoir les lire).
export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return <LegalShell>{children}</LegalShell>;
}
