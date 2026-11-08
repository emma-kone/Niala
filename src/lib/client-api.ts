"use client";

// ─────────────────────────────────────────────────────────────────────────────
// Client API unique : gestion centralisée des erreurs et des appels
// ─────────────────────────────────────────────────────────────────────────────

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: init?.body instanceof FormData ? init?.headers : { "Content-Type": "application/json", ...init?.headers },
    credentials: "same-origin",
  });
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    throw new ApiError("Réponse serveur invalide.", res.status);
  }
  if (!res.ok) {
    const message = (data as { error?: string })?.error ?? `Erreur ${res.status}`;
    throw new ApiError(message, res.status);
  }
  return data as T;
}

/** Envoi avec réponse en flux de lignes JSON : `status` et `delta` pendant la rédaction, puis le résultat final. */
export async function postStream<T>(url: string, body: unknown, on: { status: (text: string) => void; delta: (text: string) => void }): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/x-ndjson" }, body: JSON.stringify(body), credentials: "same-origin" });
  if (!res.ok || !res.body) {
    const data = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new ApiError(data?.error ?? `Erreur ${res.status}`, res.status);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result: T | undefined;
  const handle = (line: string) => {
    if (!line.trim()) return;
    const e = JSON.parse(line) as { type: string; text?: string; error?: string; status?: number } & T;
    if (e.type === "status") on.status(e.text ?? "");
    else if (e.type === "delta") on.delta(e.text ?? "");
    else if (e.type === "error") throw new ApiError(e.error ?? "Envoi impossible.", e.status ?? 500);
    else if (e.type === "done") result = e;
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let i: number;
    while ((i = buffer.indexOf("\n")) >= 0) {
      handle(buffer.slice(0, i));
      buffer = buffer.slice(i + 1);
    }
  }
  handle(buffer);
  if (result === undefined) throw new ApiError("La réponse a été interrompue.", 502);
  return result;
}

export const api = {
  get: <T>(url: string) => request<T>(url),
  post: <T>(url: string, body?: unknown) =>
    request<T>(url, { method: "POST", body: body instanceof FormData ? body : JSON.stringify(body ?? {}) }),
  put: <T>(url: string, body?: unknown) => request<T>(url, { method: "PUT", body: JSON.stringify(body ?? {}) }),
  patch: <T>(url: string, body?: unknown) => request<T>(url, { method: "PATCH", body: JSON.stringify(body ?? {}) }),
  del: <T>(url: string) => request<T>(url, { method: "DELETE" }),
};
