import Link from "next/link";
import { NialaLogo } from "@/components/brand/niala-logo";
import { LEGAL } from "@/config/legal";
import { routes } from "@/config/routes";

/** Mise en page commune des textes légaux : publique, lisible, sans dépendre de la connexion. */
export function LegalShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="mx-auto flex w-full max-w-3xl items-center justify-between px-5 py-5">
        <Link href={routes.login} aria-label={LEGAL.appName} className="inline-flex items-center">
          <NialaLogo size="sm" className="gap-2" />
        </Link>
        <nav aria-label="Textes légaux" className="flex gap-4 text-sm text-muted-foreground">
          <Link href={routes.privacy} className="hover:text-foreground">Confidentialité</Link>
          <Link href={routes.terms} className="hover:text-foreground">Conditions</Link>
        </nav>
      </header>
      <main className="mx-auto w-full max-w-3xl flex-1 px-5 pb-16">{children}</main>
      <footer className="border-t px-5 py-5 text-center text-xs text-muted-foreground">
        {LEGAL.appName} · <Link href={routes.privacy} className="hover:text-foreground">Politique de confidentialité</Link> · <Link href={routes.terms} className="hover:text-foreground">Conditions d&apos;utilisation</Link>
      </footer>
    </div>
  );
}

export function LegalDocument({ title, intro, children }: { title: string; intro: string; children: React.ReactNode }) {
  return (
    <article>
      <h1 className="typo-h1">{title}</h1>
      <p className="typo-meta mt-1">Dernière mise à jour : {LEGAL.updatedAt}</p>
      <p className="mt-4 text-base leading-relaxed">{intro}</p>
      <div className="mt-8 space-y-8">{children}</div>
    </article>
  );
}

/** Une rubrique numérotée : le titre sert aussi d'ancre pour s'y référer. */
export function LegalSection({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className="space-y-3 leading-relaxed [&_a]:underline [&_a]:underline-offset-2 [&_li]:ml-5 [&_li]:list-disc [&_li]:pl-1 [&_ul]:space-y-1.5">
      <h2 id={id} className="typo-h2">{title}</h2>
      {children}
    </section>
  );
}

export function ContactLink() {
  return <a href={`mailto:${LEGAL.contactEmail}`}>{LEGAL.contactEmail}</a>;
}
