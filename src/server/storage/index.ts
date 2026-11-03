import { mkdir, readFile, rm, writeFile, stat } from "node:fs/promises";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

// ─────────────────────────────────────────────────────────────────────────────
// Stockage des fichiers ORIGINAUX (jamais remplacés par du texte extrait).
// - Supabase Storage (bucket privé) dès que SUPABASE_SERVICE_ROLE_KEY est défini.
// - Disque local (./storage ou STORAGE_DIR) sinon — développement uniquement :
//   le disque d'une plateforme serverless n'est pas persistant.
// Les clés ne contiennent jamais le nom du fichier d'origine.
// ─────────────────────────────────────────────────────────────────────────────

export interface UploadTarget {
  url: string;
  method: "PUT";
  headers: Record<string, string>;
}

export interface FileStorage {
  readonly driver: "local" | "supabase";
  /** localUrl : route de l'application qui recevra le fichier si le driver ne fournit pas d'URL directe. */
  createUploadTarget(key: string, mime: string, localUrl: string): Promise<UploadTarget>;
  put(key: string, data: Buffer, mime: string): Promise<void>;
  read(key: string): Promise<Buffer>;
  size(key: string): Promise<number | null>;
  /** URL de lecture à courte durée (null si le driver doit servir le fichier lui-même). */
  signedReadUrl(key: string, expiresSec: number): Promise<string | null>;
  remove(keys: string[]): Promise<void>;
}

const BUCKET = process.env.SUPABASE_STORAGE_BUCKET || "documents";

/** Une clé valide est <userId>/<documentId>/<n>/<aléa> : pas de traversée de chemin. */
export function assertSafeKey(key: string) {
  if (!/^[A-Za-z0-9_-]+(\/[A-Za-z0-9_-]+){2,3}$/.test(key)) throw new Error("Clé de stockage invalide.");
}

export function localDriver(root = process.env.STORAGE_DIR || path.join(process.cwd(), "storage")): FileStorage {
  const resolve = (key: string) => {
    assertSafeKey(key);
    const full = path.resolve(root, key);
    if (!full.startsWith(path.resolve(root) + path.sep)) throw new Error("Clé de stockage invalide.");
    return full;
  };
  return {
    driver: "local",
    async createUploadTarget(_key, mime, localUrl) {
      return { url: localUrl, method: "PUT", headers: { "Content-Type": mime } };
    },
    async put(key, data) {
      const file = resolve(key);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, data);
    },
    async read(key) {
      return readFile(resolve(key));
    },
    async size(key) {
      try {
        return (await stat(resolve(key))).size;
      } catch {
        return null;
      }
    },
    async signedReadUrl() {
      return null;
    },
    async remove(keys) {
      await Promise.all(keys.map((k) => rm(resolve(k), { force: true })));
    },
  };
}

export function supabaseDriver(url: string, serviceKey: string): FileStorage {
  const client = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  let ensured = false;
  const bucket = async () => {
    if (!ensured) {
      const { error } = await client.storage.createBucket(BUCKET, { public: false });
      if (error && !/already exists|duplicate/i.test(error.message)) throw new Error("Stockage indisponible.");
      ensured = true;
    }
    return client.storage.from(BUCKET);
  };
  return {
    driver: "supabase",
    async createUploadTarget(key, mime) {
      assertSafeKey(key);
      const { data, error } = await (await bucket()).createSignedUploadUrl(key);
      if (error || !data) throw new Error("Impossible de préparer le dépôt du fichier.");
      return { url: data.signedUrl, method: "PUT", headers: { "Content-Type": mime } };
    },
    async put(key, data, mime) {
      assertSafeKey(key);
      const { error } = await (await bucket()).upload(key, data, { contentType: mime, upsert: true });
      if (error) throw new Error("Échec de l'écriture du fichier.");
    },
    async read(key) {
      assertSafeKey(key);
      const { data, error } = await (await bucket()).download(key);
      if (error || !data) throw new Error("Fichier introuvable dans le stockage.");
      return Buffer.from(await data.arrayBuffer());
    },
    async size(key) {
      assertSafeKey(key);
      const slash = key.lastIndexOf("/");
      const { data } = await (await bucket()).list(key.slice(0, slash), { search: key.slice(slash + 1), limit: 1 });
      const meta = data?.[0]?.metadata as { size?: number } | undefined;
      return meta?.size ?? null;
    },
    async signedReadUrl(key, expiresSec) {
      assertSafeKey(key);
      const { data, error } = await (await bucket()).createSignedUrl(key, expiresSec);
      return error || !data ? null : data.signedUrl;
    },
    async remove(keys) {
      if (keys.length === 0) return;
      keys.forEach(assertSafeKey);
      await (await bucket()).remove(keys);
    },
  };
}

let cached: FileStorage | undefined;

export function getStorage(): FileStorage {
  if (cached) return cached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (url && key) cached = supabaseDriver(url, key);
  else if (process.env.NODE_ENV === "production" && !process.env.STORAGE_DIR) {
    throw new Error("Stockage non configuré : définissez SUPABASE_SERVICE_ROLE_KEY (ou STORAGE_DIR).");
  } else cached = localDriver();
  return cached;
}

export function newStorageKey(userId: string, documentId: string, version: number, rand: string): string {
  return `${userId}/${documentId}/${version}/${rand}`;
}
