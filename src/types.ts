/** Current data.json format. Bump it when the schema changes and add a migration. */
export const CURRENT_STORE_VERSION = 1;

export type PositionSource = "editor" | "preview";

export interface BookmarkPosition {
  /** 0-based line. */
  readonly line: number;
  /** 0-based column. */
  readonly ch: number;
  /** Offset in the text with line endings normalized to "\n". */
  readonly offset: number;
  readonly contextBefore: string;
  readonly contextAfter: string;
  /** Full line at save time (truncated), used for preview and recovery. */
  readonly lineText: string;
  /** Markdown headings containing the position, outermost first. */
  readonly headingPath: readonly string[];
  readonly source: PositionSource;
}

/**
 * - ok: position verified or not checked yet;
 * - orphan: the file no longer exists;
 * - unresolved: the context could not be found with certainty.
 */
export type BookmarkStatus = "ok" | "orphan" | "unresolved";

export interface Bookmark {
  readonly id: string;
  readonly filePath: string;
  readonly name: string;
  /** Free-form user note; absent when empty. */
  readonly note?: string;
  readonly position: BookmarkPosition;
  /** Manual order; lower values come first. */
  readonly order: number;
  readonly status: BookmarkStatus;
  readonly createdAt: string;
  /** Last change made by the user (name, note, position, file). */
  readonly updatedAt: string;
  /** Last change of any kind, used to merge across devices. */
  readonly revisedAt: string;
}

export interface Tombstone {
  readonly id: string;
  readonly deletedAt: string;
}

export type GroupingMode =
  "none" | "topFolder" | "pathTree" | "pathFlat" | "fileName" | "modifiedDate";
export type SortMode = "manual" | "name" | "file" | "updated";
export type MissingFileBehavior = "ask" | "orphan" | "delete";
export type OpenMode = "same" | "newTab";

export interface MyObsidianBookmarkSettings {
  readonly grouping: GroupingMode;
  readonly sort: SortMode;
  readonly showPreview: boolean;
  readonly showPath: boolean;
  readonly highlightEnabled: boolean;
  readonly highlightDurationMs: number;
  readonly missingFileBehavior: MissingFileBehavior;
  readonly openMode: OpenMode;
  readonly liveTracking: boolean;
  readonly collapsedGroups: readonly string[];
}

export interface BookmarkStore {
  readonly version: typeof CURRENT_STORE_VERSION;
  readonly bookmarks: readonly Bookmark[];
  readonly tombstones: readonly Tombstone[];
  readonly settings: MyObsidianBookmarkSettings;
}

export const DEFAULT_SETTINGS: MyObsidianBookmarkSettings = {
  grouping: "pathTree",
  sort: "manual",
  showPreview: true,
  showPath: true,
  highlightEnabled: true,
  highlightDurationMs: 2000,
  missingFileBehavior: "ask",
  openMode: "same",
  liveTracking: true,
  collapsedGroups: [],
};

export function createEmptyStore(
  settings: MyObsidianBookmarkSettings = DEFAULT_SETTINGS,
): BookmarkStore {
  return { version: CURRENT_STORE_VERSION, bookmarks: [], tombstones: [], settings };
}
