"use client";

import { Download, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatDate, formatSize, STATUS_LABEL, type DocumentDetails } from "./types";

export function Properties({ doc }: { doc: DocumentDetails }) {
  const status = STATUS_LABEL[doc.status];
  const rows: [string, React.ReactNode][] = [
    ["Type", `${doc.kind.toUpperCase()} · ${doc.mime}`],
    ["Taille", formatSize(doc.size)],
    ["Pages", doc.pageCount ?? "—"],
    ["Emplacement", doc.folderPath || "Racine de la matière"],
    ["Ajouté le", formatDate(doc.createdAt)],
    ["Dernière ouverture", doc.lastOpenedAt ? formatDate(doc.lastOpenedAt) : "Jamais"],
    ["Dernière page lue", doc.lastPage ?? "—"],
    ["État du traitement", status.label],
    ["Passages indexés", doc.indexedPassages],
    ["Version", `n° ${doc.versionNumber} (${doc.versions.length} au total)`],
    ["Empreinte SHA-256", doc.sha256 ? <code className="break-all text-[11px]">{doc.sha256}</code> : "—"],
  ];
  return (
    <div className="space-y-4">
      <dl className="divide-y rounded-lg border text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-4 px-3 py-2">
            <dt className="text-muted-foreground">{k}</dt>
            <dd className="text-right font-medium">{v}</dd>
          </div>
        ))}
      </dl>
      {doc.originalMissing && (
        <p className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
          Le fichier original de ce document n&apos;a pas été conservé par l&apos;ancienne version. Réimportez-le pour pouvoir l&apos;ouvrir et le télécharger.
        </p>
      )}
      {doc.extractError && <p role="alert" className="text-sm text-destructive">{doc.extractError}</p>}
      {doc.warnings.length > 0 && (
        <div>
          <h3 className="mb-1 text-sm font-semibold">Avertissements d&apos;extraction</h3>
          <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
            {doc.warnings.slice(0, 8).map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      )}
      {!doc.originalMissing && (
        <div className="flex gap-2">
          <Button asChild variant="outline" className="gap-2">
            <a href={`/api/files/${doc.id}/content`} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="h-4 w-4" aria-hidden /> Ouvrir
            </a>
          </Button>
          <Button asChild variant="outline" className="gap-2">
            <a href={`/api/files/${doc.id}/content?download=1`}>
              <Download className="h-4 w-4" aria-hidden /> Télécharger
            </a>
          </Button>
        </div>
      )}
    </div>
  );
}
