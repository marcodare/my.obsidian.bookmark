import { StateEffect, StateField, type Extension } from "@codemirror/state";
import { Decoration, EditorView, type DecorationSet } from "@codemirror/view";
import type { Editor } from "obsidian";

const setFlash = StateEffect.define<number>();
const clearFlash = StateEffect.define<null>();

const flashLine = Decoration.line({ class: "my-obsidian-bookmark-flash" });

/** Temporary decoration of the bookmark line. */
const flashField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(decorations, tr) {
    let next = decorations.map(tr.changes);
    for (const effect of tr.effects) {
      if (effect.is(setFlash)) {
        const line = tr.state.doc.lineAt(Math.min(effect.value, tr.state.doc.length));
        next = Decoration.set([flashLine.range(line.from)]);
      } else if (effect.is(clearFlash)) {
        next = Decoration.none;
      }
    }
    return next;
  },
  provide: (field) => EditorView.decorations.from(field),
});

export const highlightExtension: Extension = [flashField];

/** CodeMirror 6 EditorView behind Obsidian's Editor (not typed in the public API). */
export function editorViewOf(editor: Editor): EditorView | null {
  const cm = (editor as unknown as { cm?: unknown }).cm;
  return cm instanceof EditorView ? cm : null;
}

/** Highlights the line containing `offset` for `durationMs` milliseconds. */
export function flashOffset(editor: Editor, offset: number, durationMs: number): void {
  const view = editorViewOf(editor);
  if (!view) return;
  view.dispatch({ effects: setFlash.of(offset) });
  window.setTimeout(() => {
    try {
      view.dispatch({ effects: clearFlash.of(null) });
    } catch {
      // The editor was closed in the meantime: nothing to clean up.
    }
  }, durationMs);
}
