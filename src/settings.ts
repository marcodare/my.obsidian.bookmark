import { PluginSettingTab, Setting, type App, type Plugin } from "obsidian";
import type { BookmarkController } from "./controller";
import type { GroupingMode, MissingFileBehavior, OpenMode, SortMode } from "./types";
import { GROUPING_LABELS, SORT_LABELS } from "./view/BookmarkView";

const MISSING_LABELS: Record<MissingFileBehavior, string> = {
  ask: "Chiedi (proponi di ricollegare)",
  orphan: "Segna come orfano",
  delete: "Elimina il bookmark (con conferma)",
};

const OPEN_LABELS: Record<OpenMode, string> = {
  same: "Nella tab corrente",
  newTab: "In una nuova tab",
};

export class LessonBookmarksSettingTab extends PluginSettingTab {
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
      .setName("Raggruppamento predefinito")
      .setDesc("Come organizzare i bookmark nella sidebar.")
      .addDropdown((d) =>
        d
          .addOptions(GROUPING_LABELS)
          .setValue(settings.grouping)
          .onChange((v) => controller.updateSettings({ grouping: v as GroupingMode })),
      );

    new Setting(containerEl)
      .setName("Ordinamento")
      .setDesc(
        "«Manuale» permette di riordinare con il menu (Sposta su/giù) o, su desktop, trascinando.",
      )
      .addDropdown((d) =>
        d
          .addOptions(SORT_LABELS)
          .setValue(settings.sort)
          .onChange((v) => controller.updateSettings({ sort: v as SortMode })),
      );

    new Setting(containerEl)
      .setName("Mostra anteprima")
      .setDesc("Testo vicino alla posizione del bookmark.")
      .addToggle((t) =>
        t
          .setValue(settings.showPreview)
          .onChange((v) => controller.updateSettings({ showPreview: v })),
      );

    new Setting(containerEl)
      .setName("Mostra percorso")
      .setDesc("Nome della nota e cartelle sotto il nome del bookmark.")
      .addToggle((t) =>
        t.setValue(settings.showPath).onChange((v) => controller.updateSettings({ showPath: v })),
      );

    new Setting(containerEl).setName("Navigazione").setHeading();

    new Setting(containerEl)
      .setName("Apertura delle note")
      .setDesc("Se la nota è già aperta, viene sempre riutilizzata la sua tab.")
      .addDropdown((d) =>
        d
          .addOptions(OPEN_LABELS)
          .setValue(settings.openMode)
          .onChange((v) => controller.updateSettings({ openMode: v as OpenMode })),
      );

    new Setting(containerEl)
      .setName("Evidenziazione temporanea")
      .setDesc("Evidenzia la riga del bookmark dopo averla raggiunta (modalità editing).")
      .addToggle((t) =>
        t
          .setValue(settings.highlightEnabled)
          .onChange((v) => controller.updateSettings({ highlightEnabled: v })),
      );

    new Setting(containerEl)
      .setName("Durata dell'evidenziazione")
      .setDesc("In secondi.")
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
      .setName("Se il file non esiste")
      .setDesc(
        "Cosa fare quando si apre un bookmark il cui file è stato rinominato, spostato o eliminato fuori da Obsidian. " +
          "I bookmark non vengono mai eliminati in automatico in background.",
      )
      .addDropdown((d) =>
        d
          .addOptions(MISSING_LABELS)
          .setValue(settings.missingFileBehavior)
          .onChange((v) =>
            controller.updateSettings({ missingFileBehavior: v as MissingFileBehavior }),
          ),
      );

    new Setting(containerEl).setName("Posizione").setHeading();

    new Setting(containerEl)
      .setName("Segui le modifiche in tempo reale")
      .setDesc(
        "Mentre scrivi, sposta i bookmark della nota insieme al testo. " +
          "Disattivandolo, la posizione viene recuperata solo tramite contesto all'apertura.",
      )
      .addToggle((t) =>
        t
          .setValue(settings.liveTracking)
          .onChange((v) => controller.updateSettings({ liveTracking: v })),
      );
  }
}
