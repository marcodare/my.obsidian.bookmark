import { MarkdownView, type App, type TFile } from "obsidian";
import { lineEndOffset, lineStartOffset, normalizeNewlines } from "../anchor/text";
import type { PositionSource } from "../types";

export interface CurrentLocation {
  readonly view: MarkdownView;
  readonly file: TFile;
  /** Document text with "\n" line endings. */
  readonly text: string;
  readonly offset: number;
  readonly source: PositionSource;
}

/**
 * Markdown view to act on. When the focus is in the sidebar, `getActiveViewOfType`
 * returns null, so the most recent leaf of the main area is used instead.
 */
export function findTargetMarkdownView(app: App): MarkdownView | null {
  const active = app.workspace.getActiveViewOfType(MarkdownView);
  if (active) return active;
  const recent = app.workspace.getMostRecentLeaf();
  return recent?.view instanceof MarkdownView ? recent.view : null;
}

/** First non-blank offset from the start of `line` (blank lines carry no useful context). */
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
 * Current position in the view:
 * - editing / Live Preview: the cursor;
 * - reading view: the first visible line (approximate, there is no cursor).
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
