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
  LessonBookmark,
  LessonBookmarksSettings,
} from "./types";
import { fileNameOf, ROOT_FOLDER_LABEL, sortBookmarks, topFolderOf } from "./view/grouping";
import { BookmarkSuggestModal, bookmarkForm, choose, confirm, showDetails } from "./view/modals";

const TRACKING_FLUSH_MS = 2000;
const PERSIST_DEBOUNCE_MS = 3000;

export const PROTOCOL_ACTION = "lesson-bookmarks";

function nowIso(): string {
  return new Date().toISOString();
}

export function newId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function")
    return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Flussi utente: creazione, navigazione, aggiornamento, eliminazione, ricollegamento. */
export class BookmarkController {
  /** Offset aggiornati in tempo reale durante la modifica, non ancora salvati. */
  private readonly liveOffsets = new Map<string, number>();
  private readonly dirtyDocs = new Map<string, Text>();
  private flushTimer: number | null = null;
  /** File già verificati in questa sessione, per non ripetere gli avvisi. */
  private readonly warnedFiles = new Set<string>();

  constructor(
    private readonly app: App,
    private readonly manager: StoreManager,
  ) {}

  get store(): BookmarkStore {
    return this.manager.store;
  }

  get settings(): LessonBookmarksSettings {
    return this.manager.store.settings;
  }

  updateSettings(patch: Partial<LessonBookmarksSettings>): void {
    this.manager.update(
      (s) => updateSettings(s, patch),
      patch.collapsedGroups ? PERSIST_DEBOUNCE_MS : 0,
    );
  }

  // ---------------------------------------------------------------- creazione

  async createAtCurrentPosition(view?: MarkdownView): Promise<void> {
    const target = view ?? findTargetMarkdownView(this.app);
    const location = target ? getCurrentLocation(target) : null;
    if (!location) {
      new Notice("Apri una nota Markdown per creare un bookmark.");
      return;
    }
    // La posizione viene letta prima del modal: il cursore potrebbe spostarsi.
    const position = capturePosition(location.text, location.offset, location.source);
    const filePath = location.file.path;
    const branch = topFolderOf(filePath);
    const result = await bookmarkForm(this.app, {
      title: "Nuovo bookmark",
      submitLabel: "Crea",
      hint:
        location.source === "preview"
          ? `Modalità lettura: verrà salvata la prima riga visibile (riga ${position.line + 1}).`
          : `${filePath} — riga ${position.line + 1}, colonna ${position.ch + 1}`,
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
        title: "Bookmark già esistente",
        message: `In questa nota esiste già il bookmark "${existing.name}" (riga ${existing.position.line + 1}).\n\nVuoi aggiornarlo alla posizione corrente?`,
        confirmLabel: "Aggiorna",
      });
      if (!update) return;
      this.discardLive(existing.id);
      const updated = this.manager.update((s) => {
        const moved = updateBookmarkPosition(s, existing.id, filePath, position, nowIso());
        // Una nota scritta ora sostituisce quella precedente; se vuota la si mantiene.
        return note.length > 0
          ? editBookmark(moved, existing.id, { name: existing.name, note }, nowIso())
          : moved;
      });
      if (updated) new Notice(`Bookmark "${existing.name}" aggiornato.`);
      return;
    }

    if (
      this.manager.update(
        (s) => createBookmark(s, { filePath, name, note, position }, nowIso(), newId()).store,
      )
    ) {
      new Notice(`Bookmark "${name}" creato.`);
    }
  }

  /** Sposta un bookmark esistente in una posizione già catturata (eventualmente in un'altra nota). */
  private moveToPosition(id: string, filePath: string, position: BookmarkPosition): void {
    const bookmark = getBookmark(this.store, id);
    if (!bookmark) return;
    const conflict = findByFileAndName(this.store, filePath, bookmark.name, id);
    if (conflict) {
      new Notice(
        `In ${fileNameOf(filePath)} esiste già un bookmark "${conflict.name}". Rinominalo prima di spostarlo.`,
      );
      return;
    }
    this.discardLive(id);
    if (this.manager.update((s) => updateBookmarkPosition(s, id, filePath, position, nowIso()))) {
      new Notice(
        `"${bookmark.name}" spostato a ${fileNameOf(filePath)}, riga ${position.line + 1}.`,
      );
    }
  }

  // ---------------------------------------------------------------- navigazione

  async goTo(id: string): Promise<void> {
    await this.flushTracking();
    const bookmark = getBookmark(this.store, id);
    if (!bookmark) {
      new Notice("Bookmark non trovato: potrebbe essere stato eliminato da un altro dispositivo.");
      return;
    }
    const file = this.app.vault.getFileByPath(bookmark.filePath);
    if (!file) {
      await this.handleMissingFile(bookmark);
      return;
    }
    const view = await openMarkdownFile(this.app, file, this.settings.openMode);
    if (!view) {
      new Notice(`Impossibile aprire ${bookmark.filePath} come nota Markdown.`);
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
    bookmark: LessonBookmark,
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
            ? `"${bookmark.name}": posizione aperta alla riga salvata; contesto registrato per i prossimi recuperi.`
            : `"${bookmark.name}": il testo è cambiato, posizione recuperata tramite contesto (riga ${offsetToPos(text, result.offset).line + 1}).`,
        );
        return;
      }

      case "ambiguous": {
        const choice = await choose<number | "current">(this.app, {
          title: `"${bookmark.name}": posizione ambigua`,
          message:
            "Il testo del bookmark compare in più punti della nota e non è possibile stabilire con certezza quale sia quello giusto. Scegli la posizione corretta:",
          list: true,
          choices: [
            ...result.candidates.map((offset) => ({
              label: `Riga ${offsetToPos(text, offset).line + 1}`,
              description: lineAt(text, offset).trim().slice(0, 140),
              value: offset as number | "current",
            })),
            {
              label: "Aggiorna alla posizione corrente del cursore",
              value: "current" as const,
              description: "Usa la posizione attuale nella nota aperta",
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
          title: `"${bookmark.name}": posizione non trovata`,
          message:
            "Il testo vicino al bookmark non è più presente nella nota: probabilmente è stato modificato o rimosso. Il bookmark non è stato spostato.\n\n" +
            `Testo salvato: «${previewOf(bookmark.position)}»`,
          list: true,
          choices: [
            {
              label: `Apri alla riga salvata (${bookmark.position.line + 1}, approssimata)`,
              description:
                "Dopo aver posizionato il cursore, usa «Aggiorna alla posizione corrente».",
              value: "line" as const,
            },
            {
              label: "Aggiorna alla posizione corrente del cursore",
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

  /** Corregge la posizione dopo un recupero riuscito. Le posizioni senza contesto lo acquisiscono ora. */
  private heal(bookmark: LessonBookmark, text: string, offset: number): void {
    const position = lacksContext(bookmark.position)
      ? capturePosition(text, offset, bookmark.position.source)
      : withOffset(text, bookmark.position, offset);
    this.discardLive(bookmark.id);
    this.manager.update((s) => healBookmarkPosition(s, bookmark.id, position, nowIso()));
  }

  // ---------------------------------------------------------------- file mancanti

  private async handleMissingFile(bookmark: LessonBookmark): Promise<void> {
    this.manager.update((s) => setBookmarkStatus(s, bookmark.id, "orphan", nowIso()));
    switch (this.settings.missingFileBehavior) {
      case "orphan":
        new Notice(
          `Il file ${bookmark.filePath} non esiste più. Il bookmark "${bookmark.name}" è segnato come orfano.`,
        );
        return;
      case "delete":
        await this.delete(bookmark.id, `Il file ${bookmark.filePath} non esiste più.`);
        return;
      case "ask":
        await this.relinkFlow(bookmark);
        return;
    }
  }

  private markdownPaths(): string[] {
    return this.app.vault.getMarkdownFiles().map((f) => f.path);
  }

  private async findCandidates(
    bookmark: LessonBookmark,
    deep: boolean,
  ): Promise<RelinkCandidate[]> {
    return findRelinkCandidates(
      bookmark,
      {
        markdownPaths: this.markdownPaths(),
        readFile: async (path) => {
          const file = this.app.vault.getFileByPath(path);
          if (!file) throw new Error(`File non trovato: ${path}`);
          return this.app.vault.cachedRead(file);
        },
      },
      deep,
    );
  }

  async relinkFlow(bookmark: LessonBookmark): Promise<void> {
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
          label: `Ricollega a ${candidate.path}`,
          description:
            candidate.result.kind === "exact"
              ? "Il testo del bookmark è presente nella stessa posizione."
              : "Il testo del bookmark è stato ritrovato in questo file.",
          value: { kind: "relink", candidate } as Action,
          cta: candidate === candidates[0],
        })),
        ...(deep
          ? []
          : [
              {
                label: "Cerca in tutto il vault",
                description: "Analizza tutte le note: può richiedere tempo.",
                value: { kind: "deep" } as Action,
              },
            ]),
        { label: "Mantieni come orfano", value: { kind: "orphan" } as Action },
        { label: "Elimina il bookmark", value: { kind: "delete" } as Action, warning: true },
      ];
      const action = await choose(this.app, {
        title: `"${bookmark.name}": file non trovato`,
        message:
          `Il file ${bookmark.filePath} non esiste più (rinominato, spostato o eliminato, anche da un altro dispositivo).` +
          (candidates.length === 0
            ? `\n\nNessun file candidato trovato${deep ? " nel vault" : " con lo stesso nome"}.`
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
        new Notice("Ricerca in tutto il vault…");
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
      new Notice(`"${bookmark.name}" ricollegato a ${candidate.path}.`);
      await this.goTo(bookmark.id);
      return;
    }
  }

  // ---------------------------------------------------------------- modifiche

  async updateToCurrentPosition(id: string, preferredView?: MarkdownView): Promise<void> {
    const bookmark = getBookmark(this.store, id);
    if (!bookmark) return;
    const view = preferredView ?? findTargetMarkdownView(this.app);
    const location: CurrentLocation | null = view ? getCurrentLocation(view) : null;
    if (!location) {
      new Notice("Apri la nota e posiziona il cursore, poi riprova.");
      return;
    }
    const targetPath = location.file.path;
    if (targetPath !== bookmark.filePath) {
      const conflict = findByFileAndName(this.store, targetPath, bookmark.name, bookmark.id);
      if (conflict) {
        new Notice(
          `In ${fileNameOf(targetPath)} esiste già un bookmark "${conflict.name}". Rinominalo prima di spostarlo.`,
        );
        return;
      }
      const move = await confirm(this.app, {
        title: "Spostare il bookmark in un'altra nota?",
        message: `"${bookmark.name}" appartiene a ${bookmark.filePath}.\n\nLa nota attiva è ${targetPath}: vuoi spostare il bookmark qui, alla posizione corrente?`,
        confirmLabel: "Sposta qui",
      });
      if (!move) return;
    }
    const position = capturePosition(location.text, location.offset, location.source);
    this.discardLive(id);
    if (this.manager.update((s) => updateBookmarkPosition(s, id, targetPath, position, nowIso()))) {
      new Notice(`"${bookmark.name}" aggiornato alla riga ${position.line + 1}.`);
    }
  }

  /** Rinomina diretta (modifica inline nella sidebar). */
  async rename(id: string, newName: string): Promise<void> {
    const bookmark = getBookmark(this.store, id);
    if (!bookmark || newName.trim() === bookmark.name) return;
    if (!this.checkName(bookmark, newName)) return;
    this.manager.update((s) => renameBookmark(s, id, newName, nowIso()));
  }

  /** Modifica nome e nota tramite modal. */
  async edit(id: string): Promise<void> {
    const bookmark = getBookmark(this.store, id);
    if (!bookmark) return;
    const result = await bookmarkForm(this.app, {
      title: "Modifica bookmark",
      submitLabel: "Salva",
      initialName: bookmark.name,
      initialNote: bookmark.note,
    });
    if (result?.kind !== "save") return;
    if (result.name !== bookmark.name && !this.checkName(bookmark, result.name)) return;
    this.manager.update((s) => editBookmark(s, id, result, nowIso()));
  }

  private checkName(bookmark: LessonBookmark, name: string): boolean {
    if (name.trim().length === 0) {
      new Notice("Il nome non può essere vuoto.");
      return false;
    }
    const conflict = findByFileAndName(this.store, bookmark.filePath, name, bookmark.id);
    if (conflict) {
      new Notice(`Esiste già un bookmark "${conflict.name}" in questa nota.`);
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
      title: "Eliminare il bookmark?",
      message: `${reason ? `${reason}\n\n` : ""}"${bookmark.name}" — ${bookmark.filePath}\n\nLa nota non verrà modificata.`,
      confirmLabel: "Elimina",
      warning: true,
    });
    if (!ok) return;
    this.discardLive(id);
    if (this.manager.update((s) => deleteBookmark(s, id, nowIso()))) {
      new Notice(`Bookmark "${bookmark.name}" eliminato.`);
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
      new Notice(`${label} copiato negli appunti.`);
    } catch {
      new Notice(`Impossibile accedere agli appunti. ${label}: ${text}`, 10000);
    }
  }

  /** Selettore rapido; senza argomenti apre il bookmark scelto. */
  openQuickSwitcher(
    bookmarks: readonly LessonBookmark[] = this.store.bookmarks,
    onChoose: (bookmark: LessonBookmark) => void = (b) => void this.goTo(b.id),
  ): void {
    new BookmarkSuggestModal(this.app, bookmarks, onChoose).open();
  }

  // ---------------------------------------------------------------- eventi del vault

  onRename(oldPath: string, newPath: string): void {
    const affected = this.store.bookmarks.some(
      (b) => b.filePath === oldPath || b.filePath.startsWith(`${oldPath}/`),
    );
    if (affected) this.manager.update((s) => relinkPaths(s, oldPath, newPath, nowIso()));
  }

  /** Un file eliminato rende orfani i suoi bookmark: non vengono mai cancellati in automatico. */
  onDelete(path: string): void {
    this.manager.update((s) => markDeletedPath(s, path, nowIso()));
  }

  /** All'apertura di una nota verifica in silenzio i suoi bookmark e corregge gli offset. */
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
        `${unresolved} bookmark di ${file.basename} non sono stati ritrovati con certezza: aprili dalla sidebar per correggerli.`,
      );
    } else if (unresolved === 0) {
      this.warnedFiles.delete(file.path);
    }
  }

  // ---------------------------------------------------------------- tracciamento in tempo reale

  onDocChanged(filePath: string, changes: ChangeDesc, doc: Text): void {
    if (!this.settings.liveTracking) return;
    let touched = false;
    for (const bookmark of this.store.bookmarks) {
      if (bookmark.filePath !== filePath) continue;
      const base = this.liveOffsets.get(bookmark.id) ?? bookmark.position.offset;
      // assoc -1: il testo digitato esattamente sul bookmark finisce dopo di esso.
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

  /** Salva gli offset tracciati ricalcolando il contesto sul testo attuale. */
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
