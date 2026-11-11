import { UnsubscribeView } from "@/features/support/unsubscribe-view";

export const metadata = { title: "Désinscription — Niala", robots: { index: false } };

export default async function UnsubscribePage({ searchParams }: { searchParams: Promise<{ t?: string }> }) {
  const { t } = await searchParams;
  return <UnsubscribeView token={t ?? ""} />;
}
