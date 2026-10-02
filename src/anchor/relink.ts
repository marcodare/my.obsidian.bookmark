import type { LessonBookmark } from "../types";
import { fileNameOf } from "../view/grouping";
import { resolvePosition, type ResolveResult } from "./resolve";
import { normalizeNewlines } from "./text";

export interface RelinkCandidate {
  readonly path: string;
  readonly result: Extract<ResolveResult, { kind: "exact" | "relocated" }>;
  /** Il nome del file coincide con quello originale. */
  readonly sameName: boolean;
}

export interface RelinkSource {
  /** Percorsi di tutti i file Markdown del vault. */
  readonly markdownPaths: readonly string[];
  readFile(path: string): Promise<string>;
}

/**
 * Cerca dove potrebbe essere finito il file di un bookmark orfano.
 * Prima controlla i file con lo stesso nome; con `deep` analizza tutto il vault.
 * Un file è candidato solo se il contesto del bookmark vi si trova in modo univoco.
 */
export async function findRelinkCandidates(
  bookmark: LessonBookmark,
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
    // Senza lo stesso nome, la sola riga è un indizio troppo debole.
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
