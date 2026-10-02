import type { ChangeDesc, Text } from "@codemirror/state";
import { MarkdownView, Notice, TFile, type App } from "obsidian";
import { capturePosition, previewOf, withOffset } from "./anchor/capture";
import { findRelinkCandidates, type RelinkCandidate } from "./anchor/relink";
import {
  fallbackOffset,
  lacksContext,
  resolvePosition,
  type ResolveResult,
} from "./anchor/resolve";
import { lineAt, normalizeNewlines, offsetToPos } from "./anchor/text";
import {
  findTargetMarkdownView,
  getCurrentLocation,
  type CurrentLocation,
} from "./editor/location";
import { openMarkdownFile, revealOffset, viewText } from "./editor/navigation";
import {
  createBookmark,
  deleteBookmark,
  duplicateBookmark,
  editBookmark,
  findByFileAndName,
  getBookmark,
  healBookmarkPosition,
  markDeletedPath,
  moveBookmark,
  moveBookmarkBefore,
  relinkBookmark,
  relinkPaths,
  renameBookmark,
  setBookmarkStatus,
  updateBookmarkPosition,
  updateSettings,
} from "./store/operations";
import type { StoreManager } from "./store/StoreManager";
import type {
  BookmarkPosition,
  BookmarkStore,
  Bookmark,
  MyObsidianBookmarkSettings,
} from "./types";
import { fileNameOf, ROOT_FOLDER_LABEL, sortBookmarks, topFolderOf } from "./view/grouping";
import { BookmarkSuggestModal, bookmarkForm, choose, confirm, showDetails } from "./view/modals";

const TRACKING_FLUSH_MS = 2000;
const PERSIST_DEBOUNCE_MS = 3000;

export const PROTOCOL_ACTION = "my-obsidian-bookmark";
/** Protocol action used before the plugin was renamed. */
export const LEGACY_PROTOCOL_ACTION = "lesson-bookmarks";

function nowIso(): string {
  return new Date().toISOString();
}

export function newId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function")
    return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** User flows: create, navigate, update, delete, relink. */
export class BookmarkController {
  /** Offsets tracked live while editing, not saved yet. */
  private readonly liveOffsets = new Map<string, number>();
  private readonly dirtyDocs = new Map<string, Text>();
  private flushTimer: number | null = null;
  /** Files already checked this session, so warnings are not repeated. */
  private readonly warnedFiles = new Set<string>();

  constructor(
    private readonly app: App,
    private readonly manager: StoreManager,
  ) {}

  get store(): BookmarkStore {
    return this.manager.store;
  }

  get settings(): MyObsidianBookmarkSettings {
    return this.manager.store.settings;
  }

  updateSettings(patch: Partial<MyObsidianBookmarkSettings>): void {
    this.manager.update(
      (s) => updateSettings(s, patch),
      patch.collapsedGroups ? PERSIST_DEBOUNCE_MS : 0,
    );
  }

  // ---------------------------------------------------------------- create

  async createAtCurrentPosition(view?: MarkdownView): Promise<void> {
    const target = view ?? findTargetMarkdownView(this.app);
    const location = target ? getCurrentLocation(target) : null;
    if (!location) {
      new Notice("Open a Markdown note to create a bookmark.");
      return;
    }
    // The position is read before the modal opens: the cursor could move.
    const position = capturePosition(location.text, location.offset, location.source);
    const filePath = location.file.path;
    const branch = topFolderOf(filePath);
    const result = await bookmarkForm(this.app, {
      title: "New bookmark",
      submitLabel: "Create",
      hint:
        location.source === "preview"
          ? `Reading view: the first visible line will be saved (line ${position.line + 1}).`
          : `${filePath} — line ${position.line + 1}, column ${position.ch + 1}`,
      movable: {
        title: `Bookmark in ${branch || ROOT_FOLDER_LABEL}`,
        bookmarks: sortBookmarks(
          this.store.bookmarks.filter((b) => topFolderOf(b.filePath) === branch),
          this.settings.sort,
        ),
      },
    });
    if (result === null) return;
    if (result.kind === "move") {
      this.moveToPosition(result.id, filePath, position);
      return;
    }
    const { name, note } = result;

    const existing = findByFileAndName(this.store, filePath, name);
    if (existing) {
      const update = await confirm(this.app, {
        title: "Bookmark already exists",
        message: `This note already has a bookmark named "${existing.name}" (line ${existing.position.line + 1}).\n\nMove it to the current position?`,
        confirmLabel: "Update",
      });
      if (!update) return;
      this.discardLive(existing.id);
      const updated = this.manager.update((s) => {
        const moved = updateBookmarkPosition(s, existing.id, filePath, position, nowIso());
        // A note written now replaces the previous one; an empty note keeps it.
        return note.length > 0
          ? editBookmark(moved, existing.id, { name: existing.name, note }, nowIso())
          : moved;
      });
      if (updated) new Notice(`Bookmark "${existing.name}" updated.`);
      return;
    }

    if (
      this.manager.update(
        (s) => createBookmark(s, { filePath, name, note, position }, nowIso(), newId()).store,
      )
    ) {
      new Notice(`Bookmark "${name}" created.`);
    }
  }

  /** Moves an existing bookmark to an already captured position (possibly in another note). */
  private moveToPosition(id: string, filePath: string, position: BookmarkPosition): void {
    const bookmark = getBookmark(this.store, id);
    if (!bookmark) return;
    const conflict = findByFileAndName(this.store, filePath, bookmark.name, id);
    if (conflict) {
      new Notice(
        `${fileNameOf(filePath)} already has a bookmark named "${conflict.name}". Rename it before moving.`,
      );
      return;
    }
    this.discardLive(id);
    if (this.manager.update((s) => updateBookmarkPosition(s, id, filePath, position, nowIso()))) {
      new Notice(`"${bookmark.name}" moved to ${fileNameOf(filePath)}, line ${position.line + 1}.`);
    }
  }

  // ---------------------------------------------------------------- navigation

  async goTo(id: string): Promise<void> {
    await this.flushTracking();
    const bookmark = getBookmark(this.store, id);
    if (!bookmark) {
      new Notice("Bookmark not found: it may have been deleted on another device.");
      return;
    }
    const file = this.app.vault.getFileByPath(bookmark.filePath);
    if (!file) {
      await this.handleMissingFile(bookmark);
      return;
    }
    const view = await openMarkdownFile(this.app, file, this.settings.openMode);
    if (!view) {
      new Notice(`Cannot open ${bookmark.filePath} as a Markdown note.`);
      return;
    }
    const text = viewText(view);
    await this.applyResolution(view, text, bookmark, resolvePosition(text, bookmark.position));
  }

  private reveal(view: MarkdownView, text: string, offset: number): void {
    revealOffset(view, text, offset, {
      highlight: this.settings.highlightEnabled,
      highlightDurationMs: this.settings.highlightDurationMs,
    });
  }

  private async applyResolution(
    view: MarkdownView,
    text: string,
    bookmark: Bookmark,
    result: ResolveResult,
  ): Promise<void> {
    switch (result.kind) {
      case "exact":
        if (bookmark.status !== "ok")
          this.manager.update((s) => setBookmarkStatus(s, bookmark.id, "ok", nowIso()));
        this.reveal(view, text, result.offset);
        return;

      case "relocated": {
        this.heal(bookmark, text, result.offset);
        this.reveal(view, text, result.offset);
        const legacy = lacksContext(bookmark.position);
        new Notice(
          legacy
            ? `"${bookmark.name}": opened at the saved line; context recorded for future lookups.`
            : `"${bookmark.name}": the text changed, position recovered from context (line ${offsetToPos(text, result.offset).line + 1}).`,
        );
        return;
      }

      case "ambiguous": {
        const choice = await choose<number | "current">(this.app, {
          title: `"${bookmark.name}": ambiguous position`,
          message:
            "The bookmark text appears in several places in the note and the right one cannot be determined with certainty. Pick the correct position:",
          list: true,
          choices: [
            ...result.candidates.map((offset) => ({
              label: `Line ${offsetToPos(text, offset).line + 1}`,
              description: lineAt(text, offset).trim().slice(0, 140),
              value: offset as number | "current",
            })),
            {
              label: "Update to the current cursor position",
              value: "current" as const,
              description: "Use the current position in the open note",
            },
          ],
        });
        if (choice === null) {
          this.manager.update((s) => setBookmarkStatus(s, bookmark.id, "unresolved", nowIso()));
          return;
        }
        if (choice === "current") {
          await this.updateToCurrentPosition(bookmark.id, view);
          return;
        }
        this.manager.update((s) =>
          healBookmarkPosition(
            s,
            bookmark.id,
            capturePosition(text, choice, bookmark.position.source),
            nowIso(),
          ),
        );
        this.reveal(view, text, choice);
        return;
      }

      case "notFound": {
        this.manager.update((s) => setBookmarkStatus(s, bookmark.id, "unresolved", nowIso()));
        const choice = await choose(this.app, {
          title: `"${bookmark.name}": position not found`,
          message:
            "The text around the bookmark is no longer in the note: it was probably edited or removed. The bookmark has not been moved.\n\n" +
            `Saved text: “${previewOf(bookmark.position)}”`,
          list: true,
          choices: [
            {
              label: `Open at the saved line (${bookmark.position.line + 1}, approximate)`,
              description: "After placing the cursor, use “Update to current position”.",
              value: "line" as const,
            },
            {
              label: "Update to the current cursor position",
              value: "current" as const,
              cta: true,
            },
          ],
        });
        if (choice === "line") {
          this.reveal(view, text, fallbackOffset(text, bookmark.position));
        } else if (choice === "current") {
          await this.updateToCurrentPosition(bookmark.id, view);
        }
        return;
      }
    }
  }

  /** Fixes the position after a successful recovery. Positions without context acquire it now. */
  private heal(bookmark: Bookmark, text: string, offset: number): void {
    const position = lacksContext(bookmark.position)
      ? capturePosition(text, offset, bookmark.position.source)
      : withOffset(text, bookmark.position, offset);
    this.discardLive(bookmark.id);
    this.manager.update((s) => healBookmarkPosition(s, bookmark.id, position, nowIso()));
  }

  // ---------------------------------------------------------------- missing files

  private async handleMissingFile(bookmark: Bookmark): Promise<void> {
    this.manager.update((s) => setBookmarkStatus(s, bookmark.id, "orphan", nowIso()));
    switch (this.settings.missingFileBehavior) {
      case "orphan":
        new Notice(
          `The file ${bookmark.filePath} no longer exists. Bookmark "${bookmark.name}" is marked as orphaned.`,
        );
        return;
      case "delete":
        await this.delete(bookmark.id, `The file ${bookmark.filePath} no longer exists.`);
        return;
      case "ask":
        await this.relinkFlow(bookmark);
        return;
    }
  }

  private markdownPaths(): string[] {
    return this.app.vault.getMarkdownFiles().map((f) => f.path);
  }

  private async findCandidates(bookmark: Bookmark, deep: boolean): Promise<RelinkCandidate[]> {
    return findRelinkCandidates(
      bookmark,
      {
        markdownPaths: this.markdownPaths(),
        readFile: async (path) => {
          const file = this.app.vault.getFileByPath(path);
          if (!file) throw new Error(`File not found: ${path}`);
          return this.app.vault.cachedRead(file);
        },
      },
      deep,
    );
  }

  async relinkFlow(bookmark: Bookmark): Promise<void> {
    let deep = false;
    let candidates = await this.findCandidates(bookmark, false);
    for (;;) {
      type Action =
        | { kind: "relink"; candidate: RelinkCandidate }
        | { kind: "deep" }
        | { kind: "orphan" }
        | { kind: "delete" };
      const choices = [
        ...candidates.map((candidate) => ({
          label: `Relink to ${candidate.path}`,
          description:
            candidate.result.kind === "exact"
              ? "The bookmark text is at the same position."
              : "The bookmark text was found in this file.",
          value: { kind: "relink", candidate } as Action,
          cta: candidate === candidates[0],
        })),
        ...(deep
          ? []
          : [
              {
                label: "Search the whole vault",
                description: "Scans every note: it may take a while.",
                value: { kind: "deep" } as Action,
              },
            ]),
        { label: "Keep as orphan", value: { kind: "orphan" } as Action },
        { label: "Delete the bookmark", value: { kind: "delete" } as Action, warning: true },
      ];
      const action = await choose(this.app, {
        title: `"${bookmark.name}": file not found`,
        message:
          `The file ${bookmark.filePath} no longer exists (renamed, moved or deleted, possibly on another device).` +
          (candidates.length === 0
            ? `\n\nNo candidate file found${deep ? " in the vault" : " with the same name"}.`
            : ""),
        list: true,
        choices,
      });
      if (action === null || action.kind === "orphan") return;
      if (action.kind === "delete") {
        await this.delete(bookmark.id);
        return;
      }
      if (action.kind === "deep") {
        deep = true;
        new Notice("Searching the whole vault…");
        candidates = await this.findCandidates(bookmark, true);
        continue;
      }
      const { candidate } = action;
      const file = this.app.vault.getFileByPath(candidate.path);
      if (!file) return;
      const text = normalizeNewlines(await this.app.vault.cachedRead(file));
      const position = withOffset(text, bookmark.position, candidate.result.offset);
      this.manager.update((s) =>
        relinkBookmark(s, bookmark.id, candidate.path, position, nowIso()),
      );
      new Notice(`"${bookmark.name}" relinked to ${candidate.path}.`);
      await this.goTo(bookmark.id);
      return;
    }
  }

  // ---------------------------------------------------------------- edits

  async updateToCurrentPosition(id: string, preferredView?: MarkdownView): Promise<void> {
    const bookmark = getBookmark(this.store, id);
    if (!bookmark) return;
    const view = preferredView ?? findTargetMarkdownView(this.app);
    const location: CurrentLocation | null = view ? getCurrentLocation(view) : null;
    if (!location) {
      new Notice("Open the note and place the cursor, then try again.");
      return;
    }
    const targetPath = location.file.path;
    if (targetPath !== bookmark.filePath) {
      const conflict = findByFileAndName(this.store, targetPath, bookmark.name, bookmark.id);
      if (conflict) {
        new Notice(
          `${fileNameOf(targetPath)} already has a bookmark named "${conflict.name}". Rename it before moving.`,
        );
        return;
      }
      const move = await confirm(this.app, {
        title: "Move the bookmark to another note?",
        message: `"${bookmark.name}" belongs to ${bookmark.filePath}.\n\nThe active note is ${targetPath}: move the bookmark here, to the current position?`,
        confirmLabel: "Move here",
      });
      if (!move) return;
    }
    const position = capturePosition(location.text, location.offset, location.source);
    this.discardLive(id);
    if (this.manager.update((s) => updateBookmarkPosition(s, id, targetPath, position, nowIso()))) {
      new Notice(`"${bookmark.name}" updated to line ${position.line + 1}.`);
    }
  }

  /** Direct rename (inline edit in the sidebar). */
  async rename(id: string, newName: string): Promise<void> {
    const bookmark = getBookmark(this.store, id);
    if (!bookmark || newName.trim() === bookmark.name) return;
    if (!this.checkName(bookmark, newName)) return;
    this.manager.update((s) => renameBookmark(s, id, newName, nowIso()));
  }

  /** Edits name and note through a modal. */
  async edit(id: string): Promise<void> {
    const bookmark = getBookmark(this.store, id);
    if (!bookmark) return;
    const result = await bookmarkForm(this.app, {
      title: "Edit bookmark",
      submitLabel: "Save",
      initialName: bookmark.name,
      initialNote: bookmark.note,
    });
    if (result?.kind !== "save") return;
    if (result.name !== bookmark.name && !this.checkName(bookmark, result.name)) return;
    this.manager.update((s) => editBookmark(s, id, result, nowIso()));
  }

  private checkName(bookmark: Bookmark, name: string): boolean {
    if (name.trim().length === 0) {
      new Notice("The name cannot be empty.");
      return false;
    }
    const conflict = findByFileAndName(this.store, bookmark.filePath, name, bookmark.id);
    if (conflict) {
      new Notice(`This note already has a bookmark named "${conflict.name}".`);
      return false;
    }
    return true;
  }

  duplicate(id: string): void {
    if (!getBookmark(this.store, id)) return;
    this.manager.update((s) => duplicateBookmark(s, id, nowIso(), newId()).store);
  }

  async delete(id: string, reason?: string): Promise<void> {
    const bookmark = getBookmark(this.store, id);
    if (!bookmark) return;
    const ok = await confirm(this.app, {
      title: "Delete the bookmark?",
      message: `${reason ? `${reason}\n\n` : ""}"${bookmark.name}" — ${bookmark.filePath}\n\nThe note will not be modified.`,
      confirmLabel: "Delete",
      warning: true,
    });
    if (!ok) return;
    this.discardLive(id);
    if (this.manager.update((s) => deleteBookmark(s, id, nowIso()))) {
      new Notice(`Bookmark "${bookmark.name}" deleted.`);
    }
  }

  move(id: string, peers: readonly string[], direction: -1 | 1): void {
    this.manager.update((s) => moveBookmark(s, id, peers, direction, nowIso()));
  }

  moveBefore(id: string, beforeId: string | null, peers: readonly string[]): void {
    this.manager.update((s) => moveBookmarkBefore(s, id, beforeId, peers, nowIso()));
  }

  showDetails(id: string): void {
    const bookmark = getBookmark(this.store, id);
    if (bookmark) showDetails(this.app, bookmark);
  }

  async openNote(id: string): Promise<void> {
    const bookmark = getBookmark(this.store, id);
    if (!bookmark) return;
    const file = this.app.vault.getFileByPath(bookmark.filePath);
    if (!file) {
      await this.handleMissingFile(bookmark);
      return;
    }
    await openMarkdownFile(this.app, file, this.settings.openMode);
  }

  linkFor(id: string): string {
    const vault = encodeURIComponent(this.app.vault.getName());
    return `obsidian://${PROTOCOL_ACTION}?vault=${vault}&id=${encodeURIComponent(id)}`;
  }

  async copyToClipboard(text: string, label: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      new Notice(`${label} copied to the clipboard.`);
    } catch {
      new Notice(`Cannot access the clipboard. ${label}: ${text}`, 10000);
    }
  }

  /** Quick switcher; with no arguments it opens the chosen bookmark. */
  openQuickSwitcher(
    bookmarks: readonly Bookmark[] = this.store.bookmarks,
    onChoose: (bookmark: Bookmark) => void = (b) => void this.goTo(b.id),
  ): void {
    new BookmarkSuggestModal(this.app, bookmarks, onChoose).open();
  }

  // ---------------------------------------------------------------- vault events

  onRename(oldPath: string, newPath: string): void {
    const affected = this.store.bookmarks.some(
      (b) => b.filePath === oldPath || b.filePath.startsWith(`${oldPath}/`),
    );
    if (affected) this.manager.update((s) => relinkPaths(s, oldPath, newPath, nowIso()));
  }

  /** A deleted file orphans its bookmarks: they are never deleted automatically. */
  onDelete(path: string): void {
    this.manager.update((s) => markDeletedPath(s, path, nowIso()));
  }

  /** When a note opens, silently checks its bookmarks and fixes their offsets. */
  async verifyFile(file: TFile): Promise<void> {
    const bookmarks = this.store.bookmarks.filter((b) => b.filePath === file.path);
    if (bookmarks.length === 0) return;
    const text = normalizeNewlines(await this.app.vault.cachedRead(file));
    let unresolved = 0;
    for (const bookmark of bookmarks) {
      if (this.liveOffsets.has(bookmark.id)) continue;
      const result = resolvePosition(text, bookmark.position);
      if (result.kind === "exact") {
        if (bookmark.status !== "ok")
          this.manager.update((s) => setBookmarkStatus(s, bookmark.id, "ok", nowIso()));
      } else if (result.kind === "relocated") {
        this.heal(bookmark, text, result.offset);
      } else {
        unresolved++;
        this.manager.update((s) => setBookmarkStatus(s, bookmark.id, "unresolved", nowIso()));
      }
    }
    if (unresolved > 0 && !this.warnedFiles.has(file.path)) {
      this.warnedFiles.add(file.path);
      new Notice(
        `${unresolved} bookmark(s) in ${file.basename} could not be located with certainty: open them from the sidebar to fix them.`,
      );
    } else if (unresolved === 0) {
      this.warnedFiles.delete(file.path);
    }
  }

  // ---------------------------------------------------------------- live tracking

  onDocChanged(filePath: string, changes: ChangeDesc, doc: Text): void {
    if (!this.settings.liveTracking) return;
    let touched = false;
    for (const bookmark of this.store.bookmarks) {
      if (bookmark.filePath !== filePath) continue;
      const base = this.liveOffsets.get(bookmark.id) ?? bookmark.position.offset;
      // assoc -1: text typed exactly at the bookmark ends up after it.
      this.liveOffsets.set(bookmark.id, changes.mapPos(base, -1));
      touched = true;
    }
    if (!touched) return;
    this.dirtyDocs.set(filePath, doc);
    if (this.flushTimer !== null) window.clearTimeout(this.flushTimer);
    this.flushTimer = window.setTimeout(() => void this.flushTracking(), TRACKING_FLUSH_MS);
  }

  private discardLive(id: string): void {
    this.liveOffsets.delete(id);
  }

  /** Saves the tracked offsets, recomputing the context on the current text. */
  async flushTracking(): Promise<void> {
    if (this.flushTimer !== null) {
      window.clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.dirtyDocs.size === 0) return;
    const docs = new Map(this.dirtyDocs);
    this.dirtyDocs.clear();
    const now = nowIso();
    const updates: { id: string; text: string; offset: number }[] = [];
    for (const [path, doc] of docs) {
      const text = doc.toString();
      for (const bookmark of this.store.bookmarks) {
        const offset = this.liveOffsets.get(bookmark.id);
        if (bookmark.filePath !== path || offset === undefined) continue;
        this.liveOffsets.delete(bookmark.id);
        updates.push({ id: bookmark.id, text, offset });
      }
    }
    if (updates.length === 0) return;
    this.manager.update((s) => {
      let next = s;
      for (const u of updates) {
        const bookmark = getBookmark(next, u.id);
        if (!bookmark) continue;
        next = healBookmarkPosition(
          next,
          u.id,
          capturePosition(u.text, u.offset, bookmark.position.source),
          now,
        );
      }
      return next;
    }, PERSIST_DEBOUNCE_MS);
  }

  isMarkdownFile(file: unknown): file is TFile {
    return file instanceof TFile && file.extension === "md";
  }
}
