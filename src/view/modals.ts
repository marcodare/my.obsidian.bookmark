import { FuzzySuggestModal, Modal, moment, Setting, type App } from "obsidian";
import { previewOf } from "../anchor/capture";
import type { LessonBookmark } from "../types";

/** Modal che si risolve con un valore, o con `null` se viene chiusa senza scelta. */
abstract class PromiseModal<T> extends Modal {
  private settled = false;
  private resolver: ((value: T | null) => void) | null = null;

  openAndWait(): Promise<T | null> {
    return new Promise((resolve) => {
      this.resolver = resolve;
      this.open();
    });
  }

  protected settle(value: T | null): void {
    if (this.settled) return;
    this.settled = true;
    this.resolver?.(value);
    this.close();
  }

  override onClose(): void {
    this.contentEl.empty();
    this.settle(null);
  }
}

export type BookmarkFormResult =
  | { readonly kind: "save"; readonly name: string; readonly note: string }
  /** L'utente ha scelto un bookmark esistente da spostare alla posizione corrente. */
  | { readonly kind: "move"; readonly id: string };

interface BookmarkFormOptions {
  readonly title: string;
  readonly submitLabel: string;
  readonly hint?: string;
  readonly initialName?: string;
  readonly initialNote?: string;
  /** Bookmark esistenti che un clic sposta alla posizione corrente. */
  readonly movable?: { readonly title: string; readonly bookmarks: readonly LessonBookmark[] };
}

class BookmarkFormModal extends PromiseModal<BookmarkFormResult> {
  constructor(
    app: App,
    private readonly options: BookmarkFormOptions,
  ) {
    super(app);
  }

  override onOpen(): void {
    const { contentEl, options } = this;
    this.setTitle(options.title);
    contentEl.addClass("lesson-bookmarks-modal");
    if (options.hint) contentEl.createEl("p", { text: options.hint, cls: "lesson-bookmarks-hint" });

    let name = options.initialName ?? "";
    let note = options.initialNote ?? "";
    let input: HTMLInputElement | null = null;
    const submit = () => {
      const trimmed = name.trim();
      if (trimmed.length === 0) {
        input?.addClass("lesson-bookmarks-invalid");
        input?.focus();
        return;
      }
      this.settle({ kind: "save", name: trimmed, note: note.trim() });
    };

    new Setting(contentEl).setName("Nome").addText((text) => {
      input = text.inputEl;
      text.setValue(name);
      text.onChange((v) => {
        name = v;
        text.inputEl.removeClass("lesson-bookmarks-invalid");
      });
      text.inputEl.addEventListener("keydown", (evt) => {
        if (evt.key === "Enter" && !evt.isComposing) {
          evt.preventDefault();
          submit();
        }
      });
    });

    new Setting(contentEl)
      .setName("Note")
      .setDesc("Facoltative. Ctrl/Cmd+Invio per salvare.")
      .setClass("lesson-bookmarks-note-setting")
      .addTextArea((area) => {
        area.setValue(note).onChange((v) => (note = v));
        area.inputEl.rows = 5;
        area.inputEl.addClass("lesson-bookmarks-note-input");
        area.inputEl.addEventListener("keydown", (evt) => {
          if (evt.key === "Enter" && (evt.metaKey || evt.ctrlKey) && !evt.isComposing) {
            evt.preventDefault();
            submit();
          }
        });
      });

    new Setting(contentEl)
      .addButton((b) => b.setButtonText("Annulla").onClick(() => this.settle(null)))
      .addButton((b) => b.setButtonText(options.submitLabel).setCta().onClick(submit));

    if (options.movable && options.movable.bookmarks.length > 0) {
      contentEl.createEl("h6", { text: options.movable.title });
      contentEl.createEl("p", {
        text: "Clic su un bookmark per spostarlo qui invece di crearne uno nuovo.",
        cls: "lesson-bookmarks-hint",
      });
      const list = contentEl.createDiv({ cls: "lesson-bookmarks-choice-list" });
      for (const bookmark of options.movable.bookmarks) {
        const item = list.createEl("button", { cls: "lesson-bookmarks-choice" });
        item.createDiv({ text: bookmark.name, cls: "lesson-bookmarks-choice-label" });
        item.createDiv({
          text: `${bookmark.filePath} — riga ${bookmark.position.line + 1}`,
          cls: "lesson-bookmarks-choice-path",
        });
        if (bookmark.note) {
          item.createDiv({ text: bookmark.note, cls: "lesson-bookmarks-choice-note" });
        }
        item.addEventListener("click", () => this.settle({ kind: "move", id: bookmark.id }));
      }
    }

    window.setTimeout(() => {
      const el = input as HTMLInputElement | null;
      el?.focus();
      el?.select();
    }, 0);
  }
}

export function bookmarkForm(
  app: App,
  options: BookmarkFormOptions,
): Promise<BookmarkFormResult | null> {
  return new BookmarkFormModal(app, options).openAndWait();
}

export interface Choice<T> {
  readonly label: string;
  readonly description?: string;
  readonly value: T;
  readonly cta?: boolean;
  readonly warning?: boolean;
}

interface ChoiceModalOptions<T> {
  readonly title: string;
  readonly message?: string;
  readonly choices: readonly Choice<T>[];
  /** Mostra le scelte come elenco verticale (es. candidati), invece che come pulsanti in riga. */
  readonly list?: boolean;
}

class ChoiceModal<T> extends PromiseModal<T> {
  constructor(
    app: App,
    private readonly options: ChoiceModalOptions<T>,
  ) {
    super(app);
  }

  override onOpen(): void {
    const { contentEl, options } = this;
    this.setTitle(options.title);
    contentEl.addClass("lesson-bookmarks-modal");
    if (options.message) {
      for (const paragraph of options.message.split("\n\n"))
        contentEl.createEl("p", { text: paragraph });
    }

    if (options.list) {
      const list = contentEl.createDiv({ cls: "lesson-bookmarks-choice-list" });
      for (const choice of options.choices) {
        const item = list.createEl("button", { cls: "lesson-bookmarks-choice" });
        if (choice.cta) item.addClass("mod-cta");
        if (choice.warning) item.addClass("mod-warning");
        item.createDiv({ text: choice.label, cls: "lesson-bookmarks-choice-label" });
        if (choice.description) {
          item.createDiv({ text: choice.description, cls: "lesson-bookmarks-choice-desc" });
        }
        item.addEventListener("click", () => this.settle(choice.value));
      }
      new Setting(contentEl).addButton((b) =>
        b.setButtonText("Annulla").onClick(() => this.settle(null)),
      );
      return;
    }

    const buttons = new Setting(contentEl);
    buttons.addButton((b) => b.setButtonText("Annulla").onClick(() => this.settle(null)));
    for (const choice of options.choices) {
      buttons.addButton((b) => {
        b.setButtonText(choice.label).onClick(() => this.settle(choice.value));
        if (choice.cta) b.setCta();
        if (choice.warning) b.setWarning();
        if (choice.description) b.setTooltip(choice.description);
      });
    }
  }
}

export function choose<T>(app: App, options: ChoiceModalOptions<T>): Promise<T | null> {
  return new ChoiceModal(app, options).openAndWait();
}

export async function confirm(
  app: App,
  options: { title: string; message: string; confirmLabel: string; warning?: boolean },
): Promise<boolean> {
  const result = await choose(app, {
    title: options.title,
    message: options.message,
    choices: [
      { label: options.confirmLabel, value: true, cta: !options.warning, warning: options.warning },
    ],
  });
  return result === true;
}

function formatDate(iso: string): string {
  return moment(iso).format("LLL");
}

class DetailsModal extends Modal {
  constructor(
    app: App,
    private readonly bookmark: LessonBookmark,
  ) {
    super(app);
  }

  override onOpen(): void {
    const { contentEl, bookmark } = this;
    const { position } = bookmark;
    this.setTitle(bookmark.name);
    contentEl.addClass("lesson-bookmarks-modal");
    const statusLabel = {
      ok: "Valido",
      orphan: "File non trovato",
      unresolved: "Posizione non verificata",
    };
    const rows: [string, string][] = [
      ["Nota", bookmark.filePath.split("/").pop() ?? bookmark.filePath],
      ["Percorso", bookmark.filePath],
      ["Riga", String(position.line + 1)],
      ["Colonna", String(position.ch + 1)],
      ["Sezione", position.headingPath.join(" › ") || "—"],
      [
        "Creato da",
        position.source === "preview"
          ? "Modalità lettura (prima riga visibile)"
          : "Cursore nell'editor",
      ],
      ["Stato", statusLabel[bookmark.status]],
      ["Creato", formatDate(bookmark.createdAt)],
      ["Ultima modifica", formatDate(bookmark.updatedAt)],
    ];
    const table = contentEl.createEl("table", { cls: "lesson-bookmarks-details" });
    for (const [label, value] of rows) {
      const tr = table.createEl("tr");
      tr.createEl("th", { text: label });
      tr.createEl("td", { text: value });
    }
    if (bookmark.note) {
      contentEl.createEl("h6", { text: "Note" });
      contentEl.createDiv({ text: bookmark.note, cls: "lesson-bookmarks-details-note" });
    }
    contentEl.createEl("h6", { text: "Anteprima" });
    contentEl.createEl("pre", {
      text: previewOf(position, 500),
      cls: "lesson-bookmarks-details-preview",
    });
  }

  override onClose(): void {
    this.contentEl.empty();
  }
}

export function showDetails(app: App, bookmark: LessonBookmark): void {
  new DetailsModal(app, bookmark).open();
}

/** Ricerca rapida tra tutti i bookmark (Command Palette). */
export class BookmarkSuggestModal extends FuzzySuggestModal<LessonBookmark> {
  constructor(
    app: App,
    private readonly bookmarks: readonly LessonBookmark[],
    private readonly onChoose: (bookmark: LessonBookmark) => void,
  ) {
    super(app);
    this.setPlaceholder("Cerca un bookmark per nome o percorso…");
  }

  getItems(): LessonBookmark[] {
    return [...this.bookmarks];
  }

  getItemText(item: LessonBookmark): string {
    return `${item.name} — ${item.filePath}`;
  }

  onChooseItem(item: LessonBookmark): void {
    this.onChoose(item);
  }
}
