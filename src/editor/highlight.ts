import { StateEffect, StateField, type Extension } from "@codemirror/state";
import { Decoration, EditorView, type DecorationSet } from "@codemirror/view";
import type { Editor } from "obsidian";

const setFlash = StateEffect.define<number>();
const clearFlash = StateEffect.define<null>();

const flashLine = Decoration.line({ class: "lesson-bookmark-flash" });

/** Decorazione temporanea della riga del bookmark. */
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

/** EditorView CodeMirror 6 dietro l'Editor di Obsidian (non tipizzato nell'API pubblica). */
export function editorViewOf(editor: Editor): EditorView | null {
  const cm = (editor as unknown as { cm?: unknown }).cm;
  return cm instanceof EditorView ? cm : null;
}

/** Evidenzia la riga contenente `offset` per `durationMs` millisecondi. */
export function flashOffset(editor: Editor, offset: number, durationMs: number): void {
  const view = editorViewOf(editor);
  if (!view) return;
  view.dispatch({ effects: setFlash.of(offset) });
  window.setTimeout(() => {
    try {
      view.dispatch({ effects: clearFlash.of(null) });
    } catch {
      // L'editor è stato chiuso nel frattempo: niente da ripulire.
    }
  }, durationMs);
}
