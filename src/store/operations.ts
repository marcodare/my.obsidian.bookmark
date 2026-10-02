import type {
  BookmarkPosition,
  BookmarkStatus,
  BookmarkStore,
  LessonBookmark,
  LessonBookmarksSettings,
} from "../types";

/** Operazioni immutabili sullo store. Ogni funzione restituisce un nuovo store. */

export interface NewBookmarkInput {
  readonly filePath: string;
  readonly name: string;
  readonly note?: string;
  readonly position: BookmarkPosition;
}

export function normalizeName(name: string): string {
  return name.trim().replace(/\s+/g, " ");
}

export function normalizeNote(note: string): string {
  return note.replace(/\r\n?/g, "\n").trim();
}

/** Imposta la nota sul bookmark, rimuovendo il campo se è vuota. */
function withNote(bookmark: LessonBookmark, note: string | undefined): LessonBookmark {
  const clean = normalizeNote(note ?? "");
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { note: _previous, ...rest } = bookmark;
  return clean.length > 0 ? { ...rest, note: clean } : rest;
}

function sameName(a: string, b: string): boolean {
  return (
    normalizeName(a).localeCompare(normalizeName(b), undefined, { sensitivity: "accent" }) === 0
  );
}

export function getBookmark(store: BookmarkStore, id: string): LessonBookmark | undefined {
  return store.bookmarks.find((b) => b.id === id);
}

/** Bookmark con lo stesso nome (senza distinzione maiuscole/minuscole) nello stesso file. */
export function findByFileAndName(
  store: BookmarkStore,
  filePath: string,
  name: string,
  excludeId?: string,
): LessonBookmark | undefined {
  return store.bookmarks.find(
    (b) => b.filePath === filePath && b.id !== excludeId && sameName(b.name, name),
  );
}

function nextOrder(store: BookmarkStore): number {
  return store.bookmarks.reduce((max, b) => Math.max(max, b.order), -1) + 1;
}

function replaceBookmark(
  store: BookmarkStore,
  id: string,
  update: (b: LessonBookmark) => LessonBookmark,
): BookmarkStore {
  if (!getBookmark(store, id)) throw new Error(`Bookmark ${id} non trovato`);
  return { ...store, bookmarks: store.bookmarks.map((b) => (b.id === id ? update(b) : b)) };
}

export function createBookmark(
  store: BookmarkStore,
  input: NewBookmarkInput,
  now: string,
  id: string,
): { store: BookmarkStore; bookmark: LessonBookmark } {
  const name = normalizeName(input.name);
  if (name.length === 0) throw new Error("Il nome del bookmark non può essere vuoto");
  const bookmark = withNote(
    {
      id,
      filePath: input.filePath,
      name,
      position: input.position,
      order: nextOrder(store),
      status: "ok",
      createdAt: now,
      updatedAt: now,
      revisedAt: now,
    },
    input.note,
  );
  return { store: { ...store, bookmarks: [...store.bookmarks, bookmark] }, bookmark };
}

export function renameBookmark(
  store: BookmarkStore,
  id: string,
  name: string,
  now: string,
): BookmarkStore {
  const clean = normalizeName(name);
  if (clean.length === 0) throw new Error("Il nome del bookmark non può essere vuoto");
  return replaceBookmark(store, id, (b) => ({ ...b, name: clean, updatedAt: now, revisedAt: now }));
}

/** Nome e nota modificati dall'utente. */
export function editBookmark(
  store: BookmarkStore,
  id: string,
  changes: { readonly name: string; readonly note: string },
  now: string,
): BookmarkStore {
  const name = normalizeName(changes.name);
  if (name.length === 0) throw new Error("Il nome del bookmark non può essere vuoto");
  return replaceBookmark(store, id, (b) =>
    withNote({ ...b, name, updatedAt: now, revisedAt: now }, changes.note),
  );
}

/** Nuova posizione scelta dall'utente (eventualmente in un altro file). */
export function updateBookmarkPosition(
  store: BookmarkStore,
  id: string,
  filePath: string,
  position: BookmarkPosition,
  now: string,
): BookmarkStore {
  return replaceBookmark(store, id, (b) => ({
    ...b,
    filePath,
    position,
    status: "ok",
    updatedAt: now,
    revisedAt: now,
  }));
}

/**
 * Correzione automatica (recupero tramite contesto, tracciamento delle modifiche):
 * non cambia `updatedAt`, che riflette solo le azioni dell'utente.
 */
export function healBookmarkPosition(
  store: BookmarkStore,
  id: string,
  position: BookmarkPosition,
  now: string,
): BookmarkStore {
  return replaceBookmark(store, id, (b) => ({ ...b, position, status: "ok", revisedAt: now }));
}

export function setBookmarkStatus(
  store: BookmarkStore,
  id: string,
  status: BookmarkStatus,
  now: string,
): BookmarkStore {
  const current = getBookmark(store, id);
  if (!current || current.status === status) return store;
  return replaceBookmark(store, id, (b) => ({ ...b, status, revisedAt: now }));
}

export function deleteBookmark(store: BookmarkStore, id: string, now: string): BookmarkStore {
  return {
    ...store,
    bookmarks: store.bookmarks.filter((b) => b.id !== id),
    tombstones: [...store.tombstones.filter((t) => t.id !== id), { id, deletedAt: now }],
  };
}

/** Nome libero nella forma "Nome (copia)", "Nome (copia 2)", ... */
export function duplicateName(store: BookmarkStore, filePath: string, name: string): string {
  const base = `${name} (copia)`;
  if (!findByFileAndName(store, filePath, base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${name} (copia ${n})`;
    if (!findByFileAndName(store, filePath, candidate)) return candidate;
  }
}

export function duplicateBookmark(
  store: BookmarkStore,
  id: string,
  now: string,
  newId: string,
): { store: BookmarkStore; bookmark: LessonBookmark } {
  const source = getBookmark(store, id);
  if (!source) throw new Error(`Bookmark ${id} non trovato`);
  const copy: LessonBookmark = {
    ...source,
    id: newId,
    name: duplicateName(store, source.filePath, source.name),
    order: source.order + 0.5,
    createdAt: now,
    updatedAt: now,
    revisedAt: now,
  };
  const withCopy = { ...store, bookmarks: [...store.bookmarks, copy] };
  return { store: normalizeOrder(withCopy, now), bookmark: copy };
}

function byOrder(a: LessonBookmark, b: LessonBookmark): number {
  return a.order - b.order || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
}

/** Riassegna gli ordini come 0..n-1 mantenendo la sequenza attuale. */
export function normalizeOrder(store: BookmarkStore, now: string): BookmarkStore {
  const sorted = [...store.bookmarks].sort(byOrder);
  const orders = new Map(sorted.map((b, i) => [b.id, i]));
  return {
    ...store,
    bookmarks: store.bookmarks.map((b) => {
      const order = orders.get(b.id) ?? b.order;
      return order === b.order ? b : { ...b, order, revisedAt: now };
    }),
  };
}

/**
 * Applica una nuova sequenza a un sottoinsieme di bookmark (es. quelli di un gruppo),
 * riutilizzando gli slot d'ordine già occupati da quel sottoinsieme.
 */
export function reorderBookmarks(
  store: BookmarkStore,
  newSequence: readonly string[],
  now: string,
): BookmarkStore {
  const members = newSequence
    .map((id) => getBookmark(store, id))
    .filter((b): b is LessonBookmark => b !== undefined);
  const slots = members.map((b) => b.order).sort((a, b) => a - b);
  const assigned = new Map(members.map((b, i) => [b.id, slots[i] as number]));
  const reordered: BookmarkStore = {
    ...store,
    bookmarks: store.bookmarks.map((b) => {
      const order = assigned.get(b.id);
      return order === undefined || order === b.order ? b : { ...b, order, revisedAt: now };
    }),
  };
  return normalizeOrder(reordered, now);
}

/** Sposta un bookmark di una posizione su (-1) o giù (+1) all'interno di `peers`. */
export function moveBookmark(
  store: BookmarkStore,
  id: string,
  peers: readonly string[],
  direction: -1 | 1,
  now: string,
): BookmarkStore {
  const index = peers.indexOf(id);
  const target = index + direction;
  if (index === -1 || target < 0 || target >= peers.length) return store;
  const sequence = [...peers];
  sequence[index] = peers[target] as string;
  sequence[target] = id;
  return reorderBookmarks(store, sequence, now);
}

/** Sposta `id` immediatamente prima di `beforeId` all'interno di `peers` (drag & drop). */
export function moveBookmarkBefore(
  store: BookmarkStore,
  id: string,
  beforeId: string | null,
  peers: readonly string[],
  now: string,
): BookmarkStore {
  if (id === beforeId || !peers.includes(id)) return store;
  const without = peers.filter((p) => p !== id);
  const index = beforeId === null ? without.length : without.indexOf(beforeId);
  if (index === -1) return store;
  const sequence = [...without.slice(0, index), id, ...without.slice(index)];
  return reorderBookmarks(store, sequence, now);
}

/** Gestisce la rinomina/lo spostamento di un file o di una cartella. */
export function relinkPaths(
  store: BookmarkStore,
  oldPath: string,
  newPath: string,
  now: string,
): BookmarkStore {
  const prefix = `${oldPath}/`;
  let changed = false;
  const bookmarks = store.bookmarks.map((b) => {
    let filePath: string | null = null;
    if (b.filePath === oldPath) filePath = newPath;
    else if (b.filePath.startsWith(prefix)) filePath = newPath + b.filePath.slice(oldPath.length);
    if (filePath === null) return b;
    changed = true;
    const status = b.status === "orphan" ? "ok" : b.status;
    return { ...b, filePath, status, updatedAt: now, revisedAt: now };
  });
  return changed ? { ...store, bookmarks } : store;
}

/** Ricollega un singolo bookmark orfano a un altro file. */
export function relinkBookmark(
  store: BookmarkStore,
  id: string,
  filePath: string,
  position: BookmarkPosition,
  now: string,
): BookmarkStore {
  return updateBookmarkPosition(store, id, filePath, position, now);
}

/** Segna come orfani i bookmark del file (o della cartella) eliminato. */
export function markDeletedPath(store: BookmarkStore, path: string, now: string): BookmarkStore {
  const prefix = `${path}/`;
  let changed = false;
  const bookmarks = store.bookmarks.map((b) => {
    if ((b.filePath !== path && !b.filePath.startsWith(prefix)) || b.status === "orphan") return b;
    changed = true;
    return { ...b, status: "orphan" as const, revisedAt: now };
  });
  return changed ? { ...store, bookmarks } : store;
}

export function updateSettings(
  store: BookmarkStore,
  patch: Partial<LessonBookmarksSettings>,
): BookmarkStore {
  return { ...store, settings: { ...store.settings, ...patch } };
}
