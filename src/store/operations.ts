import type {
  BookmarkPosition,
  BookmarkStatus,
  BookmarkStore,
  Bookmark,
  MyObsidianBookmarkSettings,
} from "../types";

/** Immutable store operations. Every function returns a new store. */

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

/** Sets the bookmark note, removing the field when empty. */
function withNote(bookmark: Bookmark, note: string | undefined): Bookmark {
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

export function getBookmark(store: BookmarkStore, id: string): Bookmark | undefined {
  return store.bookmarks.find((b) => b.id === id);
}

/** Bookmark with the same name (case-insensitive) in the same file. */
export function findByFileAndName(
  store: BookmarkStore,
  filePath: string,
  name: string,
  excludeId?: string,
): Bookmark | undefined {
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
  update: (b: Bookmark) => Bookmark,
): BookmarkStore {
  if (!getBookmark(store, id)) throw new Error(`Bookmark ${id} not found`);
  return { ...store, bookmarks: store.bookmarks.map((b) => (b.id === id ? update(b) : b)) };
}

export function createBookmark(
  store: BookmarkStore,
  input: NewBookmarkInput,
  now: string,
  id: string,
): { store: BookmarkStore; bookmark: Bookmark } {
  const name = normalizeName(input.name);
  if (name.length === 0) throw new Error("The bookmark name cannot be empty");
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
  if (clean.length === 0) throw new Error("The bookmark name cannot be empty");
  return replaceBookmark(store, id, (b) => ({ ...b, name: clean, updatedAt: now, revisedAt: now }));
}

/** Name and note edited by the user. */
export function editBookmark(
  store: BookmarkStore,
  id: string,
  changes: { readonly name: string; readonly note: string },
  now: string,
): BookmarkStore {
  const name = normalizeName(changes.name);
  if (name.length === 0) throw new Error("The bookmark name cannot be empty");
  return replaceBookmark(store, id, (b) =>
    withNote({ ...b, name, updatedAt: now, revisedAt: now }, changes.note),
  );
}

/** New position chosen by the user (possibly in another file). */
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
 * Automatic fix (context recovery, edit tracking):
 * does not change `updatedAt`, which only reflects user actions.
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

/** Free name in the form "Name (copy)", "Name (copy 2)", ... */
export function duplicateName(store: BookmarkStore, filePath: string, name: string): string {
  const base = `${name} (copy)`;
  if (!findByFileAndName(store, filePath, base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${name} (copy ${n})`;
    if (!findByFileAndName(store, filePath, candidate)) return candidate;
  }
}

export function duplicateBookmark(
  store: BookmarkStore,
  id: string,
  now: string,
  newId: string,
): { store: BookmarkStore; bookmark: Bookmark } {
  const source = getBookmark(store, id);
  if (!source) throw new Error(`Bookmark ${id} not found`);
  const copy: Bookmark = {
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

function byOrder(a: Bookmark, b: Bookmark): number {
  return a.order - b.order || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
}

/** Reassigns orders as 0..n-1 keeping the current sequence. */
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
 * Applies a new sequence to a subset of bookmarks (e.g. those of a group),
 * reusing the order slots already taken by that subset.
 */
export function reorderBookmarks(
  store: BookmarkStore,
  newSequence: readonly string[],
  now: string,
): BookmarkStore {
  const members = newSequence
    .map((id) => getBookmark(store, id))
    .filter((b): b is Bookmark => b !== undefined);
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

/** Moves a bookmark one step up (-1) or down (+1) within `peers`. */
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

/** Moves `id` right before `beforeId` within `peers` (drag & drop). */
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

/** Handles renaming/moving a file or folder. */
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

/** Relinks a single orphaned bookmark to another file. */
export function relinkBookmark(
  store: BookmarkStore,
  id: string,
  filePath: string,
  position: BookmarkPosition,
  now: string,
): BookmarkStore {
  return updateBookmarkPosition(store, id, filePath, position, now);
}

/** Marks the bookmarks of the deleted file (or folder) as orphaned. */
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
  patch: Partial<MyObsidianBookmarkSettings>,
): BookmarkStore {
  return { ...store, settings: { ...store.settings, ...patch } };
}
