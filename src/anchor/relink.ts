import type { Bookmark } from "../types";
import { fileNameOf } from "../view/grouping";
import { resolvePosition, type ResolveResult } from "./resolve";
import { normalizeNewlines } from "./text";

export interface RelinkCandidate {
  readonly path: string;
  readonly result: Extract<ResolveResult, { kind: "exact" | "relocated" }>;
  /** The file name matches the original one. */
  readonly sameName: boolean;
}

export interface RelinkSource {
  /** Paths of every Markdown file in the vault. */
  readonly markdownPaths: readonly string[];
  readFile(path: string): Promise<string>;
}

/**
 * Looks for where an orphaned bookmark's file may have gone.
 * Checks files with the same name first; with `deep` it scans the whole vault.
 * A file is a candidate only if the bookmark context occurs in it exactly once.
 */
export async function findRelinkCandidates(
  bookmark: Bookmark,
  source: RelinkSource,
  deep: boolean,
): Promise<RelinkCandidate[]> {
  const wanted = fileNameOf(bookmark.filePath);
  const paths = source.markdownPaths.filter((p) => p !== bookmark.filePath);
  const sameName = paths.filter((p) => fileNameOf(p) === wanted);
  const toScan = deep ? [...sameName, ...paths.filter((p) => fileNameOf(p) !== wanted)] : sameName;

  const candidates: RelinkCandidate[] = [];
  for (const path of toScan) {
    let text: string;
    try {
      text = normalizeNewlines(await source.readFile(path));
    } catch {
      continue;
    }
    const result = resolvePosition(text, bookmark.position);
    // Without the same name, the line alone is too weak a hint.
    const isSameName = fileNameOf(path) === wanted;
    if (
      result.kind === "exact" ||
      (result.kind === "relocated" && (isSameName || result.method !== "line"))
    ) {
      candidates.push({ path, result, sameName: isSameName });
    }
  }
  return candidates.sort((a, b) => rank(a) - rank(b));
}

function rank(c: RelinkCandidate): number {
  const quality = c.result.kind === "exact" ? 0 : c.result.method === "context" ? 1 : 2;
  return quality * 2 + (c.sameName ? 0 : 1);
}
