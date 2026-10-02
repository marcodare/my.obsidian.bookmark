import {
  createEmptyStore,
  type BookmarkStore,
  type LessonBookmark,
  type Tombstone,
} from "../types";
import {
  InvalidDataError,
  migrate,
  UnsupportedVersionError,
  type MigrationContext,
} from "./migrations";

/** Accesso al file dati, astratto per poter testare senza Obsidian. */
export interface DataIO {
  /** Contenuto JSON già interpretato, null se il file non esiste. Lancia se il JSON è corrotto. */
  load(): Promise<unknown>;
  save(store: BookmarkStore): Promise<void>;
  /** Contenuto grezzo del file, null se non esiste. */
  readRaw(): Promise<string | null>;
  /** Scrive un file di backup accanto a data.json. */
  writeBackup(fileName: string, content: string): Promise<void>;
}

export const TOMBSTONE_RETENTION_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

export type LoadOutcome =
  | { readonly kind: "ok"; readonly store: BookmarkStore; readonly warnings: readonly string[] }
  /** Il file è di una versione più recente: lo store è in sola lettura. */
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
 * Carica data.json all'avvio:
 * - file assente → store vuoto;
 * - JSON corrotto o struttura non valida → backup `data.corrupt-*.json` e store vuoto;
 * - formato vecchio → backup `data.backup-v{n}-*.json`, migrazione e salvataggio;
 * - formato più recente → store in sola lettura, il file non viene toccato.
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
        `data.json non è leggibile (${describe(error)}). Copia salvata in ${file}; si riparte da zero.`,
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
        warnings.push(`Dati aggiornati dal formato v${result.migratedFrom}. Backup: ${file}`);
      }
      if (result.droppedEntries > 0) {
        warnings.push(
          `${result.droppedEntries} voci non valide sono state ignorate. Backup: ${file}`,
        );
      }
    }
    return { kind: "ok", store: result.store, warnings };
  } catch (error) {
    if (error instanceof UnsupportedVersionError) {
      return {
        kind: "readOnly",
        store: createEmptyStore(),
        warnings: [`${error.message}. Aggiorna il plugin: le modifiche sono disabilitate.`],
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
          `data.json non è valido (${error.message}). Copia salvata in ${file}; si riparte da zero.`,
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

/** Rilegge data.json prima di una scrittura (può essere stato cambiato dal sync). */
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
 * Le modifiche dell'utente (`updatedAt`) prevalgono sulle correzioni automatiche (`revisedAt`):
 * una correzione calcolata su dati vecchi non deve annullare una rinomina o un aggiornamento
 * fatti su un altro dispositivo.
 */
function newer(a: LessonBookmark, b: LessonBookmark): LessonBookmark {
  if (a.updatedAt !== b.updatedAt) return b.updatedAt > a.updatedAt ? b : a;
  return b.revisedAt > a.revisedAt ? b : a;
}

/**
 * Unisce lo stato locale con quello letto dal disco.
 * - per ogni id vince la revisione più recente (a parità, quella locale);
 * - un bookmark cancellato su un dispositivo resta cancellato (tombstone);
 * - le impostazioni arrivano dalla sorgente indicata.
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

  const byId = new Map<string, LessonBookmark>();
  for (const b of local.bookmarks) byId.set(b.id, b);
  for (const b of remote.bookmarks) {
    const existing = byId.get(b.id);
    byId.set(b.id, existing ? newer(existing, b) : b);
  }

  // Ordine stabile: prima l'ordine locale, poi i nuovi arrivati dal remoto.
  const ids = [
    ...new Set([...local.bookmarks.map((b) => b.id), ...remote.bookmarks.map((b) => b.id)]),
  ];
  const bookmarks = ids
    .filter((id) => !tombstones.has(id))
    .map((id) => byId.get(id))
    .filter((b): b is LessonBookmark => b !== undefined);

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
