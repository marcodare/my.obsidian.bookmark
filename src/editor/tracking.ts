import type { ChangeDesc, Extension, Text } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { editorInfoField } from "obsidian";

export type DocChangeHandler = (filePath: string, changes: ChangeDesc, doc: Text) => void;

/**
 * Notifica le modifiche al documento fatte nell'editor con il focus.
 * Le altre viste dello stesso file ricevono le stesse modifiche sincronizzate da Obsidian:
 * ignorarle evita di applicare due volte lo spostamento degli offset.
 */
export function trackingExtension(onChange: DocChangeHandler): Extension {
  return EditorView.updateListener.of((update) => {
    if (!update.docChanged || !update.view.hasFocus) return;
    const path = update.state.field(editorInfoField, false)?.file?.path;
    if (path) onChange(path, update.changes, update.state.doc);
  });
}
