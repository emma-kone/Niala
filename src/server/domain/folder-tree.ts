// Logique pure de l'arborescence de dossiers (testée sans base de données).

export interface FolderNode {
  id: string;
  parentId: string | null;
  name: string;
}

export const MAX_FOLDER_DEPTH = 12;

export function normalizeFolderName(raw: string): string {
  // eslint-disable-next-line no-control-regex
  return raw.replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim();
}

export function validateFolderName(name: string): string | null {
  if (!name) return "Le nom du dossier est requis.";
  if (name.length > 80) return "Le nom du dossier ne peut pas dépasser 80 caractères.";
  if (/[\\/]/.test(name)) return "Le nom ne peut pas contenir « / » ni « \\ ».";
  if (name === "." || name === "..") return "Nom de dossier invalide.";
  return null;
}

/** Comparaison de noms insensible à la casse et aux accents (unicité dans un même dossier). */
export function nameKey(name: string): string {
  return name.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** Identifiants de tous les descendants d'un dossier (le dossier lui-même exclu). */
export function descendantIds(folders: FolderNode[], rootId: string): string[] {
  const byParent = new Map<string | null, FolderNode[]>();
  for (const f of folders) {
    const list = byParent.get(f.parentId) ?? [];
    list.push(f);
    byParent.set(f.parentId, list);
  }
  const out: string[] = [];
  const stack = [rootId];
  const seen = new Set<string>([rootId]);
  while (stack.length) {
    const id = stack.pop()!;
    for (const child of byParent.get(id) ?? []) {
      if (seen.has(child.id)) continue; // protège d'un cycle déjà corrompu
      seen.add(child.id);
      out.push(child.id);
      stack.push(child.id);
    }
  }
  return out;
}

/** Chaîne d'ancêtres (racine → dossier inclus). */
export function pathTo(folders: FolderNode[], id: string | null): FolderNode[] {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const path: FolderNode[] = [];
  const seen = new Set<string>();
  let cur = id ? byId.get(id) : undefined;
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    path.unshift(cur);
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }
  return path;
}

export function depthOf(folders: FolderNode[], id: string | null): number {
  return pathTo(folders, id).length;
}

/** Hauteur du sous-arbre (1 = dossier sans enfant). */
export function subtreeHeight(folders: FolderNode[], rootId: string): number {
  const byParent = new Map<string, FolderNode[]>();
  for (const f of folders) {
    if (!f.parentId) continue;
    const l = byParent.get(f.parentId) ?? [];
    l.push(f);
    byParent.set(f.parentId, l);
  }
  const walk = (id: string, seen: Set<string>): number => {
    if (seen.has(id)) return 0;
    seen.add(id);
    return 1 + Math.max(0, ...(byParent.get(id) ?? []).map((c) => walk(c.id, seen)));
  };
  return walk(rootId, new Set());
}

export type MoveCheck = { ok: true } | { ok: false; reason: string };

/** Peut-on placer le dossier `id` sous `targetParentId` (null = racine) ? */
export function canMoveFolder(folders: FolderNode[], id: string, targetParentId: string | null): MoveCheck {
  if (targetParentId === id) return { ok: false, reason: "Impossible de déplacer un dossier dans lui-même." };
  if (targetParentId && descendantIds(folders, id).includes(targetParentId)) {
    return { ok: false, reason: "Impossible de déplacer un dossier dans l'un de ses sous-dossiers." };
  }
  if (depthOf(folders, targetParentId) + subtreeHeight(folders, id) > MAX_FOLDER_DEPTH) {
    return { ok: false, reason: `Profondeur maximale de ${MAX_FOLDER_DEPTH} niveaux dépassée.` };
  }
  return { ok: true };
}

/** Premier nom libre « Nom », « Nom (2) », « Nom (3) »… parmi les noms existants. */
export function uniqueName(desired: string, existing: string[]): string {
  const taken = new Set(existing.map(nameKey));
  if (!taken.has(nameKey(desired))) return desired;
  for (let i = 2; i < 1000; i++) {
    const candidate = `${desired} (${i})`;
    if (!taken.has(nameKey(candidate))) return candidate;
  }
  return `${desired} (${Date.now()})`;
}
