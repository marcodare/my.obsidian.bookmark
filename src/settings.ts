import { PluginSettingTab, Setting, type App, type Plugin } from "obsidian";
import type { BookmarkController } from "./controller";
import type { GroupingMode, MissingFileBehavior, OpenMode, SortMode } from "./types";
import { GROUPING_LABELS, SORT_LABELS } from "./view/BookmarkView";

const MISSING_LABELS: Record<MissingFileBehavior, string> = {
  ask: "Ask (offer to relink)",
  orphan: "Mark as orphan",
  delete: "Delete the bookmark (with confirmation)",
};

const OPEN_LABELS: Record<OpenMode, string> = {
  same: "In the current tab",
  newTab: "In a new tab",
};

export class MyObsidianBookmarkSettingTab extends PluginSettingTab {
  constructor(
    app: App,
    plugin: Plugin,
    private readonly controller: BookmarkController,
  ) {
    super(app, plugin);
  }

  override display(): void {
    const { containerEl, controller } = this;
    const settings = controller.settings;
    containerEl.empty();

    new Setting(containerEl).setName("Sidebar").setHeading();

    new Setting(containerEl)
      .setName("Default grouping")
      .setDesc("How bookmarks are organized in the sidebar.")
      .addDropdown((d) =>
        d
          .addOptions(GROUPING_LABELS)
          .setValue(settings.grouping)
          .onChange((v) => controller.updateSettings({ grouping: v as GroupingMode })),
      );

    new Setting(containerEl)
      .setName("Sort order")
      .setDesc(
        "“Manual” lets you reorder from the menu (Move up/down) or, on desktop, by dragging.",
      )
      .addDropdown((d) =>
        d
          .addOptions(SORT_LABELS)
          .setValue(settings.sort)
          .onChange((v) => controller.updateSettings({ sort: v as SortMode })),
      );

    new Setting(containerEl)
      .setName("Show preview")
      .setDesc("Text around the bookmark position.")
      .addToggle((t) =>
        t
          .setValue(settings.showPreview)
          .onChange((v) => controller.updateSettings({ showPreview: v })),
      );

    new Setting(containerEl)
      .setName("Show path")
      .setDesc("Note name and folders below the bookmark name.")
      .addToggle((t) =>
        t.setValue(settings.showPath).onChange((v) => controller.updateSettings({ showPath: v })),
      );

    new Setting(containerEl).setName("Navigation").setHeading();

    new Setting(containerEl)
      .setName("Open notes")
      .setDesc("If the note is already open, its tab is always reused.")
      .addDropdown((d) =>
        d
          .addOptions(OPEN_LABELS)
          .setValue(settings.openMode)
          .onChange((v) => controller.updateSettings({ openMode: v as OpenMode })),
      );

    new Setting(containerEl)
      .setName("Temporary highlight")
      .setDesc("Highlights the bookmark line after jumping to it (editing view).")
      .addToggle((t) =>
        t
          .setValue(settings.highlightEnabled)
          .onChange((v) => controller.updateSettings({ highlightEnabled: v })),
      );

    new Setting(containerEl)
      .setName("Highlight duration")
      .setDesc("In seconds.")
      .addSlider((s) =>
        s
          .setLimits(0.5, 10, 0.5)
          .setValue(settings.highlightDurationMs / 1000)
          .setDynamicTooltip()
          .onChange((v) =>
            controller.updateSettings({ highlightDurationMs: Math.round(v * 1000) }),
          ),
      );

    new Setting(containerEl)
      .setName("When the file is missing")
      .setDesc(
        "What to do when opening a bookmark whose file was renamed, moved or deleted outside Obsidian. " +
          "Bookmarks are never deleted automatically in the background.",
      )
      .addDropdown((d) =>
        d
          .addOptions(MISSING_LABELS)
          .setValue(settings.missingFileBehavior)
          .onChange((v) =>
            controller.updateSettings({ missingFileBehavior: v as MissingFileBehavior }),
          ),
      );

    new Setting(containerEl).setName("Position").setHeading();

    new Setting(containerEl)
      .setName("Track edits live")
      .setDesc(
        "While you type, moves the note's bookmarks along with the text. " +
          "When off, the position is recovered from context only when the note opens.",
      )
      .addToggle((t) =>
        t
          .setValue(settings.liveTracking)
          .onChange((v) => controller.updateSettings({ liveTracking: v })),
      );
  }
}
