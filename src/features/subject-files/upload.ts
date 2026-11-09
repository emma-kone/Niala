"use client";

import { api } from "@/lib/client-api";

export type UploadPhase = "waiting" | "sending" | "processing" | "done" | "error";

export interface UploadItem {
  key: string;
  name: string;
  phase: UploadPhase;
  message?: string; // erreur ou avertissement
  documentId?: string;
}

interface PrepareResponse {
  results: (
    | { name: string; ok: true; documentId: string; versionId: string; upload: { url: string; method: "PUT"; headers: Record<string, string> } }
    | { name: string; ok: false; error: string }
  )[];
}

interface FinalizeResponse {
  ok: boolean;
  status: string;
  warnings: string[];
  error?: string;
  duplicateOf?: { id: string; name: string };
}

/** Import en 3 temps : préparation → dépôt du fichier → contrôle et extraction côté serveur. */
export async function uploadFiles(
  files: File[],
  target: { subjectId: string | null; folderId: string | null },
  onUpdate: (key: string, patch: Partial<UploadItem>) => void,
  keys: string[]
): Promise<void> {
  let prepared: PrepareResponse;
  try {
    prepared = await api.post<PrepareResponse>("/api/uploads/prepare", {
      ...target,
      files: files.map((f) => ({ name: f.name, size: f.size })),
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Préparation impossible.";
    keys.forEach((k) => onUpdate(k, { phase: "error", message }));
    return;
  }

  await Promise.all(
    prepared.results.map(async (r, i) => {
      const key = keys[i];
      if (!r.ok) return onUpdate(key, { phase: "error", message: r.error });
      onUpdate(key, { phase: "sending", documentId: r.documentId });
      try {
        const put = await fetch(r.upload.url, {
          method: r.upload.method,
          headers: r.upload.headers,
          body: files[i],
          credentials: r.upload.url.startsWith("/") ? "same-origin" : "omit",
        });
        if (!put.ok) throw new Error("Le dépôt du fichier a échoué.");
        onUpdate(key, { phase: "processing" });
        const fin = await api.post<FinalizeResponse>(`/api/uploads/${r.versionId}/finalize`);
        if (!fin.ok) return onUpdate(key, { phase: "error", message: fin.error ?? "Import refusé." });
        const notes = [
          fin.duplicateOf ? `Contenu identique à « ${fin.duplicateOf.name} ».` : null,
          fin.status === "UNSUPPORTED" ? fin.warnings[0] : fin.warnings.length ? `${fin.warnings.length} avertissement(s) d'extraction.` : null,
        ].filter(Boolean);
        onUpdate(key, { phase: "done", message: notes.join(" ") || undefined });
      } catch (e) {
        onUpdate(key, { phase: "error", message: e instanceof Error ? e.message : "Import impossible." });
      }
    })
  );
}
