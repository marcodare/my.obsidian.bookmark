import { MarkdownView, type App, type TFile } from "obsidian";
import { lineEndOffset, lineStartOffset, normalizeNewlines } from "../anchor/text";
import type { PositionSource } from "../types";

export interface CurrentLocation {
  readonly view: MarkdownView;
  readonly file: TFile;
  /** Testo del documento con "\n" come fine riga. */
  readonly text: string;
  readonly offset: number;
  readonly source: PositionSource;
}

/**
 * Vista Markdown su cui agire. Quando il focus è nella sidebar, `getActiveViewOfType`
 * restituisce null: si usa allora l'ultima foglia attiva dell'area principale.
 */
export function findTargetMarkdownView(app: App): MarkdownView | null {
  const active = app.workspace.getActiveViewOfType(MarkdownView);
  if (active) return active;
  const recent = app.workspace.getMostRecentLeaf();
  return recent?.view instanceof MarkdownView ? recent.view : null;
}

/** Primo offset non vuoto a partire dall'inizio di `line` (le righe vuote non hanno contesto utile). */
function firstContentOffset(text: string, line: number): number {
  let start = lineStartOffset(text, line);
  while (start < text.length) {
    const end = lineEndOffset(text, start);
    if (text.slice(start, end).trim().length > 0) return start;
    start = end + 1;
  }
  return lineStartOffset(text, line);
}

/**
 * Posizione corrente nella vista:
 * - modalità editing/Live Preview: il cursore;
 * - modalità lettura: la prima riga visibile (approssimata, non esiste un cursore).
 */
export function getCurrentLocation(view: MarkdownView): CurrentLocation | null {
  const file = view.file;
  if (!file || file.extension !== "md") return null;

  if (view.getMode() === "source") {
    const editor = view.editor;
    const text = normalizeNewlines(editor.getValue());
    const offset = editor.posToOffset(editor.getCursor("head"));
    return { view, file, text, offset, source: "editor" };
  }

  const text = normalizeNewlines(view.getViewData());
  const line = Math.max(0, Math.round(view.previewMode.getScroll()));
  return { view, file, text, offset: firstContentOffset(text, line), source: "preview" };
}
