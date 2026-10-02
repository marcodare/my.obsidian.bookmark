import { MarkdownView, normalizePath, Notice, Plugin, type WorkspaceLeaf } from "obsidian";
import { BookmarkController, newId, PROTOCOL_ACTION } from "./src/controller";
import { highlightExtension } from "./src/editor/highlight";
import { findTargetMarkdownView } from "./src/editor/location";
import { trackingExtension } from "./src/editor/tracking";
import { LessonBookmarksSettingTab } from "./src/settings";
import type { DataIO } from "./src/store/persistence";
import { StoreManager } from "./src/store/StoreManager";
import { BookmarkView, VIEW_TYPE_LESSON_BOOKMARKS } from "./src/view/BookmarkView";

export default class LessonBookmarksPlugin extends Plugin {
  private manager!: StoreManager;
  private controller!: BookmarkController;
  /** Pulsanti aggiunti nell'intestazione delle note, rimossi allo scaricamento del plugin. */
  private readonly headerActions = new Map<MarkdownView, HTMLElement>();

  override async onload(): Promise<void> {
    this.manager = new StoreManager({
      io: this.createDataIO(),
      clock: () => new Date().toISOString(),
      newId,
      notify: (message) => new Notice(`My Obsidian Bookmark: ${message}`, 8000),
    });
    await this.manager.load();
    this.controller = new BookmarkController(this.app, this.manager);

    this.registerView(
      VIEW_TYPE_LESSON_BOOKMARKS,
      (leaf) => new BookmarkView(leaf, this.controller, this.manager),
    );
    this.registerEditorExtension([
      highlightExtension,
      trackingExtension((path, changes, doc) => this.controller.onDocChanged(path, changes, doc)),
    ]);

    this.addRibbonIcon("bookmark", "Apri My Obsidian Bookmark", () => void this.activateView());
    this.registerCommands();
    this.registerVaultEvents();
    this.addSettingTab(new LessonBookmarksSettingTab(this.app, this, this.controller));
    this.registerObsidianProtocolHandler(PROTOCOL_ACTION, (params) => {
      if (params.id) void this.controller.goTo(params.id);
    });

    this.app.workspace.onLayoutReady(() => {
      this.addHeaderActions();
      const file = this.app.workspace.getActiveFile();
      if (this.controller.isMarkdownFile(file)) void this.controller.verifyFile(file);
    });
  }

  override async onunload(): Promise<void> {
    this.headerActions.forEach((el) => el.remove());
    this.headerActions.clear();
    await this.controller.flushTracking();
    await this.manager.flush();
  }

  /** Chiamato da Obsidian quando data.json cambia sul disco (es. sincronizzazione). */
  override async onExternalSettingsChange(): Promise<void> {
    await this.manager.reloadFromDisk();
  }

  private createDataIO(): DataIO {
    const dir =
      this.manifest.dir ?? normalizePath(`${this.app.vault.configDir}/plugins/${this.manifest.id}`);
    const adapter = this.app.vault.adapter;
    const dataPath = normalizePath(`${dir}/data.json`);
    return {
      load: () => this.loadData() as Promise<unknown>,
      save: (store) => this.saveData(store),
      readRaw: async () => ((await adapter.exists(dataPath)) ? adapter.read(dataPath) : null),
      writeBackup: (fileName, content) =>
        adapter.write(normalizePath(`${dir}/${fileName}`), content),
    };
  }

  private registerCommands(): void {
    this.addCommand({
      id: "add-bookmark",
      name: "Aggiungi bookmark alla posizione corrente",
      icon: "bookmark-plus",
      checkCallback: (checking) => {
        const view = findTargetMarkdownView(this.app);
        if (!view?.file) return false;
        if (!checking) void this.controller.createAtCurrentPosition(view);
        return true;
      },
    });

    this.addCommand({
      id: "update-bookmark-here",
      name: "Aggiorna un bookmark di questa nota alla posizione corrente",
      icon: "locate",
      checkCallback: (checking) => {
        const view = findTargetMarkdownView(this.app);
        const path = view?.file?.path;
        const bookmarks = path
          ? this.manager.store.bookmarks.filter((b) => b.filePath === path)
          : [];
        if (!view || bookmarks.length === 0) return false;
        if (!checking) {
          this.controller.openQuickSwitcher(
            bookmarks,
            (b) => void this.controller.updateToCurrentPosition(b.id, view),
          );
        }
        return true;
      },
    });

    this.addCommand({
      id: "open-view",
      name: "Apri pannello",
      icon: "bookmark",
      callback: () => void this.activateView(),
    });

    this.addCommand({
      id: "go-to-bookmark",
      name: "Vai a un bookmark…",
      icon: "search",
      callback: () => this.controller.openQuickSwitcher(),
    });
  }

  private registerVaultEvents(): void {
    this.registerEvent(
      this.app.vault.on("rename", (file, oldPath) => this.controller.onRename(oldPath, file.path)),
    );
    this.registerEvent(this.app.vault.on("delete", (file) => this.controller.onDelete(file.path)));
    this.registerEvent(
      this.app.workspace.on("file-open", (file) => {
        if (this.controller.isMarkdownFile(file)) void this.controller.verifyFile(file);
      }),
    );
    this.registerEvent(this.app.workspace.on("layout-change", () => this.addHeaderActions()));
    this.registerEvent(this.app.workspace.on("active-leaf-change", () => this.addHeaderActions()));
  }

  /** Pulsante "nuovo bookmark" nell'intestazione di ogni nota (desktop e mobile). */
  private addHeaderActions(): void {
    for (const [view, el] of this.headerActions) {
      if (!view.containerEl.isConnected) {
        el.remove();
        this.headerActions.delete(view);
      }
    }
    this.app.workspace.iterateAllLeaves((leaf: WorkspaceLeaf) => {
      const view = leaf.view;
      if (!(view instanceof MarkdownView) || this.headerActions.has(view)) return;
      const action = view.addAction(
        "bookmark-plus",
        "Aggiungi bookmark",
        () => void this.controller.createAtCurrentPosition(view),
      );
      this.headerActions.set(view, action);
    });
  }

  async activateView(): Promise<void> {
    const { workspace } = this.app;
    const existing = workspace.getLeavesOfType(VIEW_TYPE_LESSON_BOOKMARKS)[0];
    const leaf =
      existing ??
      (await workspace.ensureSideLeaf(VIEW_TYPE_LESSON_BOOKMARKS, "right", { active: true }));
    await workspace.revealLeaf(leaf);
  }
}
