import {
  CURRENT_STORE_VERSION,
  type BookmarkStore,
  type LessonBookmark,
  type Tombstone,
} from "../types";
import {
  bookmarkSchema,
  legacyV0Schema,
  settingsSchema,
  storeV1Envelope,
  tombstoneSchema,
} from "./schema";

export class InvalidDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidDataError";
  }
}

/** data.json scritto da una versione più recente del plugin: non va sovrascritto. */
export class UnsupportedVersionError extends Error {
  constructor(readonly version: number) {
    super(`data.json usa il formato v${version}, non supportato da questa versione del plugin`);
    this.name = "UnsupportedVersionError";
  }
}

export interface MigrationResult {
  readonly store: BookmarkStore;
  /** Versione di partenza se è stata applicata una migrazione, altrimenti null. */
  readonly migratedFrom: number | null;
  /** Voci scartate perché non valide. */
  readonly droppedEntries: number;
}

export interface MigrationContext {
  readonly now: string;
  readonly newId: () => string;
}

function detectVersion(raw: unknown): number {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new InvalidDataError("data.json non contiene un oggetto");
  }
  const version = (raw as { version?: unknown }).version;
  if (version === undefined) return 0;
  if (typeof version !== "number" || !Number.isInteger(version) || version < 0) {
    throw new InvalidDataError("campo version non valido");
  }
  return version;
}

function migrateV0(raw: unknown, ctx: MigrationContext): { data: unknown; dropped: number } {
  const parsed = legacyV0Schema.safeParse(raw);
  if (!parsed.success) throw new InvalidDataError("formato v0 non riconosciuto");
  let dropped = 0;
  const bookmarks = parsed.data.bookmarks.flatMap((old, index) => {
    const filePath = old.filePath ?? old.file;
    if (!filePath) {
      dropped++;
      return [];
    }
    const createdAt = old.createdAt ?? ctx.now;
    const updatedAt = old.updatedAt ?? createdAt;
    const bookmark: LessonBookmark = {
      id: old.id ?? ctx.newId(),
      filePath,
      name: old.name,
      position: {
        line: old.line,
        ch: old.ch ?? 0,
        offset: 0,
        contextBefore: "",
        contextAfter: "",
        lineText: "",
        headingPath: [],
        source: "editor",
      },
      order: index,
      status: "ok",
      createdAt,
      updatedAt,
      revisedAt: ctx.now,
    };
    return [bookmark];
  });
  return { data: { version: 1, bookmarks, tombstones: [], settings: undefined }, dropped };
}

function parseV1(raw: unknown): { store: BookmarkStore; dropped: number } {
  const envelope = storeV1Envelope.safeParse(raw);
  if (!envelope.success) throw new InvalidDataError("struttura di data.json non valida");

  let dropped = 0;
  const bookmarks: LessonBookmark[] = [];
  const seen = new Set<string>();
  for (const entry of envelope.data.bookmarks) {
    const parsed = bookmarkSchema.safeParse(entry);
    if (!parsed.success || seen.has(parsed.data.id)) {
      dropped++;
      continue;
    }
    seen.add(parsed.data.id);
    bookmarks.push(parsed.data);
  }
  const tombstones: Tombstone[] = envelope.data.tombstones.flatMap((t) => {
    const parsed = tombstoneSchema.safeParse(t);
    return parsed.success ? [parsed.data] : [];
  });
  const settings = settingsSchema.parse(envelope.data.settings);
  return { store: { version: CURRENT_STORE_VERSION, bookmarks, tombstones, settings }, dropped };
}

/**
 * Converte qualsiasi versione supportata di data.json nel formato corrente.
 * Lancia InvalidDataError se i dati sono illeggibili, UnsupportedVersionError se sono troppo nuovi.
 */
export function migrate(raw: unknown, ctx: MigrationContext): MigrationResult {
  const from = detectVersion(raw);
  if (from > CURRENT_STORE_VERSION) throw new UnsupportedVersionError(from);

  let data = raw;
  let dropped = 0;
  if (from === 0) {
    const step = migrateV0(data, ctx);
    data = step.data;
    dropped += step.dropped;
  }
  // Le migrazioni future vanno aggiunte qui in sequenza: if (version === 1) { ... }

  const parsed = parseV1(data);
  return {
    store: parsed.store,
    migratedFrom: from === CURRENT_STORE_VERSION ? null : from,
    droppedEntries: dropped + parsed.dropped,
  };
}
