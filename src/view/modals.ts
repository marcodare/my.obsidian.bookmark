import { FuzzySuggestModal, Modal, moment, Setting, type App } from "obsidian";
import { previewOf } from "../anchor/capture";
import type { Bookmark } from "../types";

/** Modal that resolves with a value, or with `null` when closed without a choice. */
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
  /** The user picked an existing bookmark to move to the current position. */
  | { readonly kind: "move"; readonly id: string };

interface BookmarkFormOptions {
  readonly title: string;
  readonly submitLabel: string;
  readonly hint?: string;
  readonly initialName?: string;
  readonly initialNote?: string;
  /** Existing bookmarks that a click moves to the current position. */
  readonly movable?: { readonly title: string; readonly bookmarks: readonly Bookmark[] };
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
    contentEl.addClass("my-obsidian-bookmark-modal");
    if (options.hint)
      contentEl.createEl("p", { text: options.hint, cls: "my-obsidian-bookmark-hint" });

    let name = options.initialName ?? "";
    let note = options.initialNote ?? "";
    let input: HTMLInputElement | null = null;
    const submit = () => {
      const trimmed = name.trim();
      if (trimmed.length === 0) {
        input?.addClass("my-obsidian-bookmark-invalid");
        input?.focus();
        return;
      }
      this.settle({ kind: "save", name: trimmed, note: note.trim() });
    };

    new Setting(contentEl).setName("Name").addText((text) => {
      input = text.inputEl;
      text.setValue(name);
      text.onChange((v) => {
        name = v;
        text.inputEl.removeClass("my-obsidian-bookmark-invalid");
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
      .setDesc("Optional. Ctrl/Cmd+Enter to save.")
      .setClass("my-obsidian-bookmark-note-setting")
      .addTextArea((area) => {
        area.setValue(note).onChange((v) => (note = v));
        area.inputEl.rows = 5;
        area.inputEl.addClass("my-obsidian-bookmark-note-input");
        area.inputEl.addEventListener("keydown", (evt) => {
          if (evt.key === "Enter" && (evt.metaKey || evt.ctrlKey) && !evt.isComposing) {
            evt.preventDefault();
            submit();
          }
        });
      });

    new Setting(contentEl)
      .addButton((b) => b.setButtonText("Cancel").onClick(() => this.settle(null)))
      .addButton((b) => b.setButtonText(options.submitLabel).setCta().onClick(submit));

    if (options.movable && options.movable.bookmarks.length > 0) {
      contentEl.createEl("h6", { text: options.movable.title });
      contentEl.createEl("p", {
        text: "Click a bookmark to move it here instead of creating a new one.",
        cls: "my-obsidian-bookmark-hint",
      });
      const list = contentEl.createDiv({ cls: "my-obsidian-bookmark-choice-list" });
      for (const bookmark of options.movable.bookmarks) {
        const item = list.createEl("button", { cls: "my-obsidian-bookmark-choice" });
        item.createDiv({ text: bookmark.name, cls: "my-obsidian-bookmark-choice-label" });
        item.createDiv({
          text: `${bookmark.filePath} — line ${bookmark.position.line + 1}`,
          cls: "my-obsidian-bookmark-choice-path",
        });
        if (bookmark.note) {
          item.createDiv({ text: bookmark.note, cls: "my-obsidian-bookmark-choice-note" });
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
  /** Shows the choices as a vertical list (e.g. candidates) instead of a row of buttons. */
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
    contentEl.addClass("my-obsidian-bookmark-modal");
    if (options.message) {
      for (const paragraph of options.message.split("\n\n"))
        contentEl.createEl("p", { text: paragraph });
    }

    if (options.list) {
      const list = contentEl.createDiv({ cls: "my-obsidian-bookmark-choice-list" });
      for (const choice of options.choices) {
        const item = list.createEl("button", { cls: "my-obsidian-bookmark-choice" });
        if (choice.cta) item.addClass("mod-cta");
        if (choice.warning) item.addClass("mod-warning");
        item.createDiv({ text: choice.label, cls: "my-obsidian-bookmark-choice-label" });
        if (choice.description) {
          item.createDiv({ text: choice.description, cls: "my-obsidian-bookmark-choice-desc" });
        }
        item.addEventListener("click", () => this.settle(choice.value));
      }
      new Setting(contentEl).addButton((b) =>
        b.setButtonText("Cancel").onClick(() => this.settle(null)),
      );
      return;
    }

    const buttons = new Setting(contentEl);
    buttons.addButton((b) => b.setButtonText("Cancel").onClick(() => this.settle(null)));
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
    private readonly bookmark: Bookmark,
  ) {
    super(app);
  }

  override onOpen(): void {
    const { contentEl, bookmark } = this;
    const { position } = bookmark;
    this.setTitle(bookmark.name);
    contentEl.addClass("my-obsidian-bookmark-modal");
    const statusLabel = {
      ok: "Valid",
      orphan: "File not found",
      unresolved: "Position not verified",
    };
    const rows: [string, string][] = [
      ["Note", bookmark.filePath.split("/").pop() ?? bookmark.filePath],
      ["Path", bookmark.filePath],
      ["Line", String(position.line + 1)],
      ["Column", String(position.ch + 1)],
      ["Section", position.headingPath.join(" › ") || "—"],
      [
        "Created from",
        position.source === "preview" ? "Reading view (first visible line)" : "Editor cursor",
      ],
      ["Status", statusLabel[bookmark.status]],
      ["Created", formatDate(bookmark.createdAt)],
      ["Last modified", formatDate(bookmark.updatedAt)],
    ];
    const table = contentEl.createEl("table", { cls: "my-obsidian-bookmark-details" });
    for (const [label, value] of rows) {
      const tr = table.createEl("tr");
      tr.createEl("th", { text: label });
      tr.createEl("td", { text: value });
    }
    if (bookmark.note) {
      contentEl.createEl("h6", { text: "Note" });
      contentEl.createDiv({ text: bookmark.note, cls: "my-obsidian-bookmark-details-note" });
    }
    contentEl.createEl("h6", { text: "Preview" });
    contentEl.createEl("pre", {
      text: previewOf(position, 500),
      cls: "my-obsidian-bookmark-details-preview",
    });
  }

  override onClose(): void {
    this.contentEl.empty();
  }
}

export function showDetails(app: App, bookmark: Bookmark): void {
  new DetailsModal(app, bookmark).open();
}

/** Quick search across all bookmarks (command palette). */
export class BookmarkSuggestModal extends FuzzySuggestModal<Bookmark> {
  constructor(
    app: App,
    private readonly bookmarks: readonly Bookmark[],
    private readonly onChoose: (bookmark: Bookmark) => void,
  ) {
    super(app);
    this.setPlaceholder("Search a bookmark by name or path…");
  }

  getItems(): Bookmark[] {
    return [...this.bookmarks];
  }

  getItemText(item: Bookmark): string {
    return `${item.name} — ${item.filePath}`;
  }

  onChooseItem(item: Bookmark): void {
    this.onChoose(item);
  }
}
