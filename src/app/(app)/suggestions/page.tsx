import { HelpSection } from "@/features/support/help-section";

export const metadata = { title: "Suggestions et retours — Niala" };

/** Module Suggestions : envoyer un retour à l'équipe Niala, suivre ses demandes et lire les réponses. */
export default function SuggestionsPage() {
  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-6 lg:py-8">
      <header className="mb-5">
        <h1 className="typo-h1">Suggestions et retours</h1>
        <p className="typo-subtitle mt-1">Proposez une amélioration, signalez un problème ou demandez de l&apos;aide. L&apos;équipe Niala lit chaque message et vous répond ici.</p>
      </header>
      <HelpSection page />
    </div>
  );
}
