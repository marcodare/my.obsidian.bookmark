import {
  ItemView,
  Menu,
  moment,
  Platform,
  SearchComponent,
  setIcon,
  setTooltip,
  type WorkspaceLeaf,
} from "obsidian";
import { previewOf } from "../anchor/capture";
import type { BookmarkController } from "../controller";
import type { StoreManager } from "../store/StoreManager";
import type { GroupingMode, LessonBookmark, SortMode } from "../types";
import { filterBookmarks } from "./filter";
import { collectGroupKeys, fileNameOf, folderOf, groupBookmarks, type GroupNode } from "./grouping";

export const VIEW_TYPE_LESSON_BOOKMARKS = "lesson-bookmarks-view";

export const GROUPING_LABELS: Record<GroupingMode, string> = {
  pathTree: "Percorso (albero)",
  pathFlat: "Percorso completo",
  topFolder: "Cartella principale",
  fileName: "Nome file",
  modifiedDate: "Data di modifica",
  none: "Nessun raggruppamento",
};

export const SORT_LABELS: Record<SortMode, string> = {
  manual: "Manuale",
  name: "Nome",
  file: "File e posizione",
  updated: "Ultima modifica",
};

const DRAG_MIME = "application/x-lesson-bookmark";

/** Ultime cartelle del percorso, per non occupare tutta la larghezza della sidebar. */
function abbreviateFolder(path: string, keep = 3): string {
  const parts = folderOf(path).split("/").filter(Boolean);
  if (parts.length === 0) return "";
  return parts.length <= keep ? parts.join("/") : `…/${parts.slice(-keep).join("/")}`;
}

function formatDate(iso: string): string {
  return moment(iso).format("LLL");
}

export class BookmarkView extends ItemView {
  private query = "";
  private listEl!: HTMLElement;
  private countEl!: HTMLElement;
  private expandButton!: HTMLElement;
  private renderQueued = false;
  /** Durante la rinomina inline il ridisegno viene rimandato per non perdere l'input. */
  private editing = false;
  private draggingId: string | null = null;
  private unsubscribe: (() => void) | null = null;
  private lastRoot: GroupNode | null = null;

  constructor(
    leaf: WorkspaceLeaf,
    private readonly controller: BookmarkController,
    private readonly manager: StoreManager,
  ) {
    super(leaf);
    this.navigation = false;
  }

  getViewType(): string {
    return VIEW_TYPE_LESSON_BOOKMARKS;
  }

  getDisplayText(): string {
    return "My Obsidian Bookmark";
  }

  override getIcon(): string {
    return "bookmark";
  }

  override async onOpen(): Promise<void> {
    const root = this.contentEl;
    root.empty();
    root.addClass("lesson-bookmarks-view");

    const header = root.createDiv({ cls: "nav-header lesson-bookmarks-header" });
    const buttons = header.createDiv({ cls: "nav-buttons-container" });
    this.addHeaderButton(
      buttons,
      "bookmark-plus",
      "Nuovo bookmark nella nota attiva",
      () => void this.controller.createAtCurrentPosition(),
    );
    this.addHeaderButton(
      buttons,
      "rotate-cw",
      "Aggiorna (ricarica data.json e verifica i file)",
      () => void this.refresh(),
    );
    this.expandButton = this.addHeaderButton(buttons, "chevrons-down-up", "Comprimi tutto", () =>
      this.toggleAll(),
    );
    this.addHeaderButton(buttons, "layers", "Raggruppa per…", (evt) => this.showGroupingMenu(evt));
    this.addHeaderButton(buttons, "arrow-up-down", "Ordina per…", (evt) => this.showSortMenu(evt));

    const search = new SearchComponent(root.createDiv({ cls: "lesson-bookmarks-search" }));
    search.setPlaceholder("Cerca… (name:  path:)");
    search.onChange((value) => {
      this.query = value;
      this.requestRender();
    });

    this.countEl = root.createDiv({ cls: "lesson-bookmarks-count" });
    this.listEl = root.createDiv({ cls: "lesson-bookmarks-list" });

    this.unsubscribe = this.manager.subscribe(() => this.requestRender());
    this.registerEvent(this.app.vault.on("create", () => this.requestRender()));
    this.render();
  }

  override async onClose(): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  private addHeaderButton(
    parent: HTMLElement,
    icon: string,
    label: string,
    onClick: (evt: MouseEvent) => void,
  ): HTMLElement {
    const button = parent.createDiv({
      cls: "clickable-icon nav-action-button",
      attr: { "aria-label": label },
    });
    setIcon(button, icon);
    button.addEventListener("click", onClick);
    return button;
  }

  requestRender(): void {
    if (this.renderQueued) return;
    this.renderQueued = true;
    window.requestAnimationFrame(() => {
      this.renderQueued = false;
      if (!this.editing) this.render();
    });
  }

  private async refresh(): Promise<void> {
    await this.manager.reloadFromDisk();
    this.render();
  }

  private isOrphan(bookmark: LessonBookmark): boolean {
    return this.app.vault.getFileByPath(bookmark.filePath) === null;
  }

  // ---------------------------------------------------------------- render

  private render(): void {
    if (!this.listEl) return;
    const { bookmarks, settings } = this.manager.store;
    const visible = filterBookmarks(bookmarks, this.query);
    this.countEl.setText(
      visible.length === bookmarks.length
        ? `Totale: ${bookmarks.length}`
        : `Totale: ${bookmarks.length} · trovati: ${visible.length}`,
    );
    if (this.manager.isReadOnly)
      this.countEl.createSpan({ text: " · sola lettura", cls: "mod-warning" });

    this.listEl.empty();
    if (bookmarks.length === 0) {
      this.renderEmpty(
        "Nessun bookmark.",
        "Posiziona il cursore in una nota e usa il pulsante 🔖+ nell'intestazione della nota o il comando «Aggiungi bookmark alla posizione corrente».",
      );
      this.lastRoot = null;
      return;
    }
    if (visible.length === 0) {
      this.renderEmpty("Nessun risultato.", "Prova a cambiare la ricerca.");
      this.lastRoot = null;
      return;
    }

    const root = groupBookmarks(visible, settings.grouping, settings.sort);
    this.lastRoot = root;
    // Durante una ricerca i gruppi sono sempre espansi, per vedere i risultati.
    const collapsed = this.query.trim() ? new Set<string>() : new Set(settings.collapsedGroups);
    this.renderNode(root, this.listEl, collapsed);
    this.updateExpandButton();
  }

  private renderEmpty(title: string, hint: string): void {
    const empty = this.listEl.createDiv({ cls: "lesson-bookmarks-empty" });
    empty.createDiv({ text: title, cls: "lesson-bookmarks-empty-title" });
    empty.createDiv({ text: hint });
  }

  private renderNode(
    node: GroupNode,
    container: HTMLElement,
    collapsed: ReadonlySet<string>,
  ): void {
    for (const group of node.children) this.renderGroup(group, container, collapsed);
    const peers = node.bookmarks.map((b) => b.id);
    for (const bookmark of node.bookmarks) this.renderBookmark(bookmark, container, peers);
  }

  private renderGroup(
    group: GroupNode,
    container: HTMLElement,
    collapsed: ReadonlySet<string>,
  ): void {
    const isCollapsed = collapsed.has(group.key);
    const item = container.createDiv({ cls: "lesson-bookmarks-group" });
    if (isCollapsed) item.addClass("is-collapsed");

    const header = item.createDiv({
      cls: "lesson-bookmarks-group-header",
      attr: { tabindex: "0", role: "button" },
    });
    setIcon(
      header.createSpan({ cls: "lesson-bookmarks-group-chevron" }),
      isCollapsed ? "chevron-right" : "chevron-down",
    );
    setIcon(
      header.createSpan({ cls: "lesson-bookmarks-group-icon" }),
      group.kind === "file" ? "file-text" : group.kind === "bucket" ? "calendar" : "folder",
    );
    header.createSpan({ text: group.label, cls: "lesson-bookmarks-group-label" });
    header.createSpan({ text: String(group.count), cls: "lesson-bookmarks-group-count" });
    setTooltip(header, group.key.replace(/^\w+:/, "") || group.label);

    const toggle = () => this.toggleGroup(group.key);
    header.addEventListener("click", toggle);
    header.addEventListener("keydown", (evt) => {
      if (evt.key === "Enter" || evt.key === " ") {
        evt.preventDefault();
        toggle();
      }
    });

    if (!isCollapsed)
      this.renderNode(group, item.createDiv({ cls: "lesson-bookmarks-children" }), collapsed);
  }

  private renderBookmark(
    bookmark: LessonBookmark,
    container: HTMLElement,
    peers: readonly string[],
  ): void {
    const { settings } = this.manager.store;
    const orphan = this.isOrphan(bookmark);
    const item = container.createDiv({
      cls: "lesson-bookmark-item",
      attr: { tabindex: "0", role: "button", "data-id": bookmark.id },
    });
    if (orphan) item.addClass("is-orphan");
    if (bookmark.status === "unresolved") item.addClass("is-unresolved");

    const row = item.createDiv({ cls: "lesson-bookmark-row" });
    setIcon(
      row.createSpan({ cls: "lesson-bookmark-icon" }),
      orphan ? "file-x" : bookmark.status === "unresolved" ? "alert-triangle" : "bookmark",
    );
    const nameEl = row.createSpan({ text: bookmark.name, cls: "lesson-bookmark-name" });
    row.createSpan({ text: moment(bookmark.updatedAt).fromNow(), cls: "lesson-bookmark-date" });
    const more = row.createDiv({
      cls: "clickable-icon lesson-bookmark-more",
      attr: { "aria-label": "Azioni" },
    });
    setIcon(more, "more-horizontal");

    if (settings.showPath) {
      const meta = item.createDiv({ cls: "lesson-bookmark-meta" });
      meta.createSpan({ text: fileNameOf(bookmark.filePath), cls: "lesson-bookmark-note" });
      const folder = abbreviateFolder(bookmark.filePath);
      if (folder) meta.createSpan({ text: folder, cls: "lesson-bookmark-path" });
    }
    if (settings.showPreview) {
      item.createDiv({ text: previewOf(bookmark.position), cls: "lesson-bookmark-preview" });
    }
    if (bookmark.note) {
      item.createDiv({ text: bookmark.note, cls: "lesson-bookmark-note-text" });
    }

    const statusNote = orphan
      ? "\n⚠ File non trovato"
      : bookmark.status === "unresolved"
        ? "\n⚠ Posizione da verificare"
        : "";
    setTooltip(
      item,
      `${bookmark.filePath}\nRiga ${bookmark.position.line + 1}, colonna ${bookmark.position.ch + 1}\n` +
        `Creato: ${formatDate(bookmark.createdAt)}\nUltima modifica: ${formatDate(bookmark.updatedAt)}${statusNote}` +
        (bookmark.note ? `\n\n${bookmark.note}` : ""),
      { placement: "left" },
    );

    item.addEventListener("click", (evt) => {
      if (more.contains(evt.target as Node)) return;
      void this.controller.goTo(bookmark.id);
    });
    item.addEventListener("keydown", (evt) => {
      if (evt.target !== item) return;
      if (evt.key === "Enter") void this.controller.goTo(bookmark.id);
      if (evt.key === "F2") this.startInlineRename(bookmark, nameEl);
    });
    item.addEventListener("contextmenu", (evt) => {
      evt.preventDefault();
      this.showBookmarkMenu(bookmark, peers, orphan, evt);
    });
    more.addEventListener("click", (evt) => {
      evt.stopPropagation();
      this.showBookmarkMenu(bookmark, peers, orphan, evt);
    });
    nameEl.addEventListener("dblclick", (evt) => {
      evt.stopPropagation();
      this.startInlineRename(bookmark, nameEl);
    });

    if (Platform.isDesktop && settings.sort === "manual") this.enableDrag(item, bookmark.id, peers);
  }

  // ---------------------------------------------------------------- azioni

  private showBookmarkMenu(
    bookmark: LessonBookmark,
    peers: readonly string[],
    orphan: boolean,
    evt: MouseEvent,
  ): void {
    const c = this.controller;
    const menu = new Menu();
    menu.addItem((i) =>
      i
        .setTitle("Vai al bookmark")
        .setIcon("navigation")
        .onClick(() => void c.goTo(bookmark.id)),
    );
    menu.addItem((i) =>
      i
        .setTitle("Aggiorna alla posizione corrente")
        .setIcon("locate")
        .onClick(() => void c.updateToCurrentPosition(bookmark.id)),
    );
    menu.addItem((i) =>
      i
        .setTitle("Modifica nome e note")
        .setIcon("pencil")
        .onClick(() => void c.edit(bookmark.id)),
    );
    menu.addItem((i) =>
      i
        .setTitle("Duplica")
        .setIcon("copy-plus")
        .onClick(() => c.duplicate(bookmark.id)),
    );

    if (this.manager.store.settings.sort === "manual") {
      const index = peers.indexOf(bookmark.id);
      menu.addSeparator();
      menu.addItem((i) =>
        i
          .setTitle("Sposta su")
          .setIcon("arrow-up")
          .setDisabled(index <= 0)
          .onClick(() => c.move(bookmark.id, peers, -1)),
      );
      menu.addItem((i) =>
        i
          .setTitle("Sposta giù")
          .setIcon("arrow-down")
          .setDisabled(index === -1 || index >= peers.length - 1)
          .onClick(() => c.move(bookmark.id, peers, 1)),
      );
    }

    menu.addSeparator();
    menu.addItem((i) =>
      i
        .setTitle("Apri nota")
        .setIcon("file-text")
        .onClick(() => void c.openNote(bookmark.id)),
    );
    menu.addItem((i) =>
      i
        .setTitle("Copia link")
        .setIcon("link")
        .onClick(() => void c.copyToClipboard(c.linkFor(bookmark.id), "Link")),
    );
    menu.addItem((i) =>
      i
        .setTitle("Copia percorso")
        .setIcon("clipboard-copy")
        .onClick(() => void c.copyToClipboard(bookmark.filePath, "Percorso")),
    );
    menu.addItem((i) =>
      i
        .setTitle("Mostra dettagli")
        .setIcon("info")
        .onClick(() => c.showDetails(bookmark.id)),
    );
    if (orphan) {
      menu.addItem((i) =>
        i
          .setTitle("Ricollega a un file…")
          .setIcon("file-search")
          .onClick(() => void c.relinkFlow(bookmark)),
      );
    }
    menu.addSeparator();
    menu.addItem((i) =>
      i
        .setTitle("Elimina")
        .setIcon("trash-2")
        .setWarning(true)
        .onClick(() => void c.delete(bookmark.id)),
    );
    menu.showAtMouseEvent(evt);
  }

  private startInlineRename(bookmark: LessonBookmark, nameEl: HTMLElement): void {
    if (this.editing) return;
    this.editing = true;
    const input = createEl("input", {
      type: "text",
      value: bookmark.name,
      cls: "lesson-bookmark-rename",
    });
    nameEl.replaceWith(input);
    input.focus();
    input.select();

    let done = false;
    const finish = async (save: boolean) => {
      if (done) return;
      done = true;
      this.editing = false;
      if (save) await this.controller.rename(bookmark.id, input.value);
      this.render();
    };
    input.addEventListener("click", (evt) => evt.stopPropagation());
    input.addEventListener("keydown", (evt) => {
      evt.stopPropagation();
      if (evt.key === "Enter" && !evt.isComposing) void finish(true);
      if (evt.key === "Escape") void finish(false);
    });
    input.addEventListener("blur", () => void finish(true));
  }

  private enableDrag(item: HTMLElement, id: string, peers: readonly string[]): void {
    item.draggable = true;
    item.addEventListener("dragstart", (evt) => {
      this.draggingId = id;
      evt.dataTransfer?.setData(DRAG_MIME, id);
      if (evt.dataTransfer) evt.dataTransfer.effectAllowed = "move";
      item.addClass("is-dragging");
    });
    item.addEventListener("dragend", () => {
      this.draggingId = null;
      item.removeClass("is-dragging");
    });
    const clear = () => item.removeClasses(["drop-before", "drop-after"]);
    item.addEventListener("dragover", (evt) => {
      // Il riordino vale solo all'interno dello stesso gruppo.
      if (!this.draggingId || this.draggingId === id || !peers.includes(this.draggingId)) return;
      evt.preventDefault();
      const after = evt.offsetY > item.clientHeight / 2;
      item.toggleClass("drop-after", after);
      item.toggleClass("drop-before", !after);
    });
    item.addEventListener("dragleave", clear);
    item.addEventListener("drop", (evt) => {
      clear();
      const dragged = this.draggingId;
      if (!dragged || dragged === id || !peers.includes(dragged)) return;
      evt.preventDefault();
      const after = evt.offsetY > item.clientHeight / 2;
      const others = peers.filter((p) => p !== dragged);
      const beforeId = after ? (others[others.indexOf(id) + 1] ?? null) : id;
      this.controller.moveBefore(dragged, beforeId, peers);
    });
  }

  // ---------------------------------------------------------------- gruppi

  private toggleGroup(key: string): void {
    const current = new Set(this.manager.store.settings.collapsedGroups);
    if (current.has(key)) current.delete(key);
    else current.add(key);
    this.controller.updateSettings({ collapsedGroups: [...current] });
  }

  private allCollapsed(): boolean {
    if (!this.lastRoot) return false;
    const collapsed = new Set(this.manager.store.settings.collapsedGroups);
    const keys = this.lastRoot.children.map((c) => c.key);
    return keys.length > 0 && keys.every((k) => collapsed.has(k));
  }

  private toggleAll(): void {
    if (!this.lastRoot) return;
    const expand = this.allCollapsed();
    this.controller.updateSettings({
      collapsedGroups: expand ? [] : collectGroupKeys(this.lastRoot),
    });
  }

  private updateExpandButton(): void {
    const collapsed = this.allCollapsed();
    setIcon(this.expandButton, collapsed ? "chevrons-up-down" : "chevrons-down-up");
    this.expandButton.setAttr("aria-label", collapsed ? "Espandi tutto" : "Comprimi tutto");
  }

  private showGroupingMenu(evt: MouseEvent): void {
    const menu = new Menu();
    const current = this.manager.store.settings.grouping;
    for (const [mode, label] of Object.entries(GROUPING_LABELS) as [GroupingMode, string][]) {
      menu.addItem((i) =>
        i
          .setTitle(label)
          .setChecked(mode === current)
          .onClick(() => this.controller.updateSettings({ grouping: mode })),
      );
    }
    menu.showAtMouseEvent(evt);
  }

  private showSortMenu(evt: MouseEvent): void {
    const menu = new Menu();
    const current = this.manager.store.settings.sort;
    for (const [mode, label] of Object.entries(SORT_LABELS) as [SortMode, string][]) {
      menu.addItem((i) =>
        i
          .setTitle(label)
          .setChecked(mode === current)
          .onClick(() => this.controller.updateSettings({ sort: mode })),
      );
    }
    menu.showAtMouseEvent(evt);
  }
}
