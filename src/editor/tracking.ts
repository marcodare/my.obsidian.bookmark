import type { ChangeDesc, Extension, Text } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { editorInfoField } from "obsidian";

export type DocChangeHandler = (filePath: string, changes: ChangeDesc, doc: Text) => void;

/**
 * Reports document changes made in the focused editor.
 * Other views of the same file receive the same changes, synced by Obsidian:
 * ignoring them avoids shifting the offsets twice.
 */
export function trackingExtension(onChange: DocChangeHandler): Extension {
  return EditorView.updateListener.of((update) => {
    if (!update.docChanged || !update.view.hasFocus) return;
    const path = update.state.field(editorInfoField, false)?.file?.path;
    if (path) onChange(path, update.changes, update.state.doc);
  });
}
