/** Formato corrente di data.json. Incrementare quando cambia lo schema e aggiungere una migrazione. */
export const CURRENT_STORE_VERSION = 1;

export type PositionSource = "editor" | "preview";

export interface BookmarkPosition {
  /** Riga 0-based. */
  readonly line: number;
  /** Colonna 0-based. */
  readonly ch: number;
  /** Offset nel testo con fine riga normalizzati a "\n". */
  readonly offset: number;
  readonly contextBefore: string;
  readonly contextAfter: string;
  /** Riga completa al momento del salvataggio (troncata), usata per anteprima e recupero. */
  readonly lineText: string;
  /** Titoli Markdown che contengono la posizione, dal livello più alto. */
  readonly headingPath: readonly string[];
  readonly source: PositionSource;
}

/**
 * - ok: posizione verificata o non ancora controllata;
 * - orphan: il file non esiste più;
 * - unresolved: il contesto non è stato ritrovato con certezza.
 */
export type BookmarkStatus = "ok" | "orphan" | "unresolved";

export interface LessonBookmark {
  readonly id: string;
  readonly filePath: string;
  readonly name: string;
  /** Nota libera dell'utente; assente se vuota. */
  readonly note?: string;
  readonly position: BookmarkPosition;
  /** Ordine manuale; valori più bassi vengono prima. */
  readonly order: number;
  readonly status: BookmarkStatus;
  readonly createdAt: string;
  /** Ultima modifica fatta dall'utente (nome, nota, posizione, file). */
  readonly updatedAt: string;
  /** Ultima modifica di qualsiasi tipo, usata per l'unione tra dispositivi. */
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

export interface LessonBookmarksSettings {
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
  readonly bookmarks: readonly LessonBookmark[];
  readonly tombstones: readonly Tombstone[];
  readonly settings: LessonBookmarksSettings;
}

export const DEFAULT_SETTINGS: LessonBookmarksSettings = {
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
  settings: LessonBookmarksSettings = DEFAULT_SETTINGS,
): BookmarkStore {
  return { version: CURRENT_STORE_VERSION, bookmarks: [], tombstones: [], settings };
}
