import { createEmptyStore, type BookmarkStore, type Bookmark, type Tombstone } from "../types";
import {
  InvalidDataError,
  migrate,
  UnsupportedVersionError,
  type MigrationContext,
} from "./migrations";

/** Data file access, abstracted so it can be tested without Obsidian. */
export interface DataIO {
  /** Parsed JSON content, null when the file does not exist. Throws on corrupt JSON. */
  load(): Promise<unknown>;
  save(store: BookmarkStore): Promise<void>;
  /** Raw file content, null when it does not exist. */
  readRaw(): Promise<string | null>;
  /** Writes a backup file next to data.json. */
  writeBackup(fileName: string, content: string): Promise<void>;
}

export const TOMBSTONE_RETENTION_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

export type LoadOutcome =
  | { readonly kind: "ok"; readonly store: BookmarkStore; readonly warnings: readonly string[] }
  /** The file comes from a newer version: the store is read-only. */
  | {
      readonly kind: "readOnly";
      readonly store: BookmarkStore;
      readonly warnings: readonly string[];
    };

function stamp(now: string): string {
  return now.replace(/[:.]/g, "-");
}

async function backupRaw(io: DataIO, fileName: string, fallback: unknown): Promise<string> {
  let content: string | null = null;
  try {
    content = await io.readRaw();
  } catch {
    content = null;
  }
  await io.writeBackup(fileName, content ?? JSON.stringify(fallback, null, 2));
  return fileName;
}

/**
 * Loads data.json at startup:
 * - missing file → empty store;
 * - corrupt JSON or invalid structure → `data.corrupt-*.json` backup and empty store;
 * - older format → `data.backup-v{n}-*.json` backup, migration and save;
 * - newer format → read-only store, the file is left untouched.
 */
export async function loadStore(io: DataIO, ctx: MigrationContext): Promise<LoadOutcome> {
  let raw: unknown;
  try {
    raw = await io.load();
  } catch (error) {
    const file = await backupRaw(io, `data.corrupt-${stamp(ctx.now)}.json`, null);
    const store = createEmptyStore();
    await io.save(store);
    return {
      kind: "ok",
      store,
      warnings: [
        `data.json is unreadable (${describe(error)}). Copy saved to ${file}; starting from scratch.`,
      ],
    };
  }

  if (raw === null || raw === undefined)
    return { kind: "ok", store: createEmptyStore(), warnings: [] };

  try {
    const result = migrate(raw, ctx);
    const warnings: string[] = [];
    if (result.migratedFrom !== null || result.droppedEntries > 0) {
      const prefix =
        result.migratedFrom !== null
          ? `data.backup-v${result.migratedFrom}`
          : "data.backup-invalid";
      const file = await backupRaw(io, `${prefix}-${stamp(ctx.now)}.json`, raw);
      await io.save(result.store);
      if (result.migratedFrom !== null) {
        warnings.push(`Data upgraded from format v${result.migratedFrom}. Backup: ${file}`);
      }
      if (result.droppedEntries > 0) {
        warnings.push(`${result.droppedEntries} invalid entries were ignored. Backup: ${file}`);
      }
    }
    return { kind: "ok", store: result.store, warnings };
  } catch (error) {
    if (error instanceof UnsupportedVersionError) {
      return {
        kind: "readOnly",
        store: createEmptyStore(),
        warnings: [`${error.message}. Update the plugin: editing is disabled.`],
      };
    }
    if (error instanceof InvalidDataError) {
      const file = await backupRaw(io, `data.corrupt-${stamp(ctx.now)}.json`, raw);
      const store = createEmptyStore();
      await io.save(store);
      return {
        kind: "ok",
        store,
        warnings: [
          `data.json is invalid (${error.message}). Copy saved to ${file}; starting from scratch.`,
        ],
      };
    }
    throw error;
  }
}

export type RemoteRead =
  | { readonly kind: "ok"; readonly store: BookmarkStore }
  | { readonly kind: "missing" }
  | { readonly kind: "corrupt"; readonly backup: string }
  | { readonly kind: "newer"; readonly version: number };

/** Re-reads data.json before a write (sync may have changed it). */
export async function readRemote(io: DataIO, ctx: MigrationContext): Promise<RemoteRead> {
  let raw: unknown;
  try {
    raw = await io.load();
  } catch {
    return {
      kind: "corrupt",
      backup: await backupRaw(io, `data.corrupt-${stamp(ctx.now)}.json`, null),
    };
  }
  if (raw === null || raw === undefined) return { kind: "missing" };
  try {
    return { kind: "ok", store: migrate(raw, ctx).store };
  } catch (error) {
    if (error instanceof UnsupportedVersionError) return { kind: "newer", version: error.version };
    if (error instanceof InvalidDataError) {
      return {
        kind: "corrupt",
        backup: await backupRaw(io, `data.corrupt-${stamp(ctx.now)}.json`, raw),
      };
    }
    throw error;
  }
}

/**
 * User changes (`updatedAt`) win over automatic fixes (`revisedAt`):
 * a fix computed on stale data must not undo a rename or update
 * made on another device.
 */
function newer(a: Bookmark, b: Bookmark): Bookmark {
  if (a.updatedAt !== b.updatedAt) return b.updatedAt > a.updatedAt ? b : a;
  return b.revisedAt > a.revisedAt ? b : a;
}

/**
 * Merges the local state with the one read from disk.
 * - for each id the most recent revision wins (local on a tie);
 * - a bookmark deleted on one device stays deleted (tombstone);
 * - settings come from the given source.
 */
export function mergeStores(
  local: BookmarkStore,
  remote: BookmarkStore,
  options: { readonly settingsFrom: "local" | "remote"; readonly now: string },
): BookmarkStore {
  const tombstones = new Map<string, Tombstone>();
  for (const t of [...remote.tombstones, ...local.tombstones]) {
    const existing = tombstones.get(t.id);
    if (!existing || t.deletedAt > existing.deletedAt) tombstones.set(t.id, t);
  }
  const cutoff = new Date(
    Date.parse(options.now) - TOMBSTONE_RETENTION_DAYS * DAY_MS,
  ).toISOString();
  const keptTombstones = [...tombstones.values()].filter((t) => t.deletedAt >= cutoff);

  const byId = new Map<string, Bookmark>();
  for (const b of local.bookmarks) byId.set(b.id, b);
  for (const b of remote.bookmarks) {
    const existing = byId.get(b.id);
    byId.set(b.id, existing ? newer(existing, b) : b);
  }

  // Stable order: local order first, then newcomers from the remote.
  const ids = [
    ...new Set([...local.bookmarks.map((b) => b.id), ...remote.bookmarks.map((b) => b.id)]),
  ];
  const bookmarks = ids
    .filter((id) => !tombstones.has(id))
    .map((id) => byId.get(id))
    .filter((b): b is Bookmark => b !== undefined);

  return {
    version: local.version,
    bookmarks,
    tombstones: keptTombstones,
    settings: options.settingsFrom === "local" ? local.settings : remote.settings,
  };
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
