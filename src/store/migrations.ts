import { CURRENT_STORE_VERSION, type BookmarkStore, type Bookmark, type Tombstone } from "../types";
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

/** data.json written by a newer plugin version: it must not be overwritten. */
export class UnsupportedVersionError extends Error {
  constructor(readonly version: number) {
    super(`data.json uses format v${version}, not supported by this plugin version`);
    this.name = "UnsupportedVersionError";
  }
}

export interface MigrationResult {
  readonly store: BookmarkStore;
  /** Source version when a migration was applied, otherwise null. */
  readonly migratedFrom: number | null;
  /** Entries dropped because they were invalid. */
  readonly droppedEntries: number;
}

export interface MigrationContext {
  readonly now: string;
  readonly newId: () => string;
}

function detectVersion(raw: unknown): number {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new InvalidDataError("data.json does not contain an object");
  }
  const version = (raw as { version?: unknown }).version;
  if (version === undefined) return 0;
  if (typeof version !== "number" || !Number.isInteger(version) || version < 0) {
    throw new InvalidDataError("invalid version field");
  }
  return version;
}

function migrateV0(raw: unknown, ctx: MigrationContext): { data: unknown; dropped: number } {
  const parsed = legacyV0Schema.safeParse(raw);
  if (!parsed.success) throw new InvalidDataError("unrecognized v0 format");
  let dropped = 0;
  const bookmarks = parsed.data.bookmarks.flatMap((old, index) => {
    const filePath = old.filePath ?? old.file;
    if (!filePath) {
      dropped++;
      return [];
    }
    const createdAt = old.createdAt ?? ctx.now;
    const updatedAt = old.updatedAt ?? createdAt;
    const bookmark: Bookmark = {
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
  if (!envelope.success) throw new InvalidDataError("invalid data.json structure");

  let dropped = 0;
  const bookmarks: Bookmark[] = [];
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
 * Converts any supported data.json version to the current format.
 * Throws InvalidDataError when the data is unreadable, UnsupportedVersionError when it is too new.
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
  // Add future migrations here, in sequence: if (version === 1) { ... }

  const parsed = parseV1(data);
  return {
    store: parsed.store,
    migratedFrom: from === CURRENT_STORE_VERSION ? null : from,
    droppedEntries: dropped + parsed.dropped,
  };
}
