import { MarkdownView, type App, type TFile, type WorkspaceLeaf } from "obsidian";
import { normalizeNewlines, offsetToPos } from "../anchor/text";
import type { OpenMode } from "../types";
import { flashOffset } from "./highlight";

function leafShowsFile(leaf: WorkspaceLeaf, path: string): boolean {
  if (leaf.view instanceof MarkdownView) return leaf.view.file?.path === path;
  // Foglia differita (in background, non ancora caricata).
  const state = leaf.getViewState().state as { file?: unknown } | undefined;
  return state?.file === path;
}

/** Apre il file riusando una tab che lo mostra già; altrimenti segue `openMode`. */
export async function openMarkdownFile(
  app: App,
  file: TFile,
  openMode: OpenMode,
): Promise<MarkdownView | null> {
  const existing = app.workspace
    .getLeavesOfType("markdown")
    .find((leaf) => leafShowsFile(leaf, file.path));
  const leaf = existing ?? app.workspace.getLeaf(openMode === "newTab" ? "tab" : false);
  if (!existing) await leaf.openFile(file);
  await leaf.loadIfDeferred();
  app.workspace.setActiveLeaf(leaf, { focus: true });
  await app.workspace.revealLeaf(leaf);
  return leaf.view instanceof MarkdownView ? leaf.view : null;
}

/** Testo attuale del documento aperto nella vista. */
export function viewText(view: MarkdownView): string {
  return normalizeNewlines(
    view.getMode() === "source" ? view.editor.getValue() : view.getViewData(),
  );
}

export interface RevealOptions {
  readonly highlight: boolean;
  readonly highlightDurationMs: number;
}

/** Porta cursore e scroll sull'offset; in modalità lettura scorre alla riga. */
export function revealOffset(
  view: MarkdownView,
  text: string,
  offset: number,
  options: RevealOptions,
): void {
  const pos = offsetToPos(text, offset);
  if (view.getMode() === "source") {
    const editor = view.editor;
    editor.setCursor(pos);
    editor.scrollIntoView({ from: pos, to: pos }, true);
    editor.focus();
    if (options.highlight)
      flashOffset(editor, editor.posToOffset(pos), options.highlightDurationMs);
  } else {
    // In lettura non c'è cursore: Obsidian scorre alla riga indicata.
    view.setEphemeralState({ line: pos.line });
  }
}
