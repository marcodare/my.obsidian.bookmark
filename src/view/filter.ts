import { previewOf } from "../anchor/capture";
import type { LessonBookmark } from "../types";

export interface SearchQuery {
  /** Termini cercati in nome, percorso, anteprima e note. */
  readonly text: readonly string[];
  readonly name: readonly string[];
  readonly path: readonly string[];
}

/** Minuscolo e senza accenti, per confronti tolleranti. */
export function fold(value: string): string {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

const TOKEN_RE = /(\w+:)?(?:"([^"]*)"|(\S+))/g;

/**
 * Interpreta la ricerca. Sintassi:
 *   policy routing          → entrambi i termini, ovunque
 *   name:"da verificare"    → solo nel nome
 *   path:linux file:lesson  → solo nel percorso
 */
export function parseQuery(input: string): SearchQuery {
  const text: string[] = [];
  const name: string[] = [];
  const path: string[] = [];
  for (const match of input.matchAll(TOKEN_RE)) {
    const prefix = match[1]?.toLowerCase();
    const value = fold(match[2] ?? match[3] ?? "").trim();
    if (value.length === 0) continue;
    if (prefix === "name:" || prefix === "nome:") name.push(value);
    else if (prefix === "path:" || prefix === "file:") path.push(value);
    else text.push(fold(match[0].replace(/"/g, "")));
  }
  return { text, name, path };
}

export function isEmptyQuery(q: SearchQuery): boolean {
  return q.text.length === 0 && q.name.length === 0 && q.path.length === 0;
}

export function matchesQuery(bookmark: LessonBookmark, query: SearchQuery): boolean {
  const name = fold(bookmark.name);
  const path = fold(bookmark.filePath);
  const all = `${name}\n${path}\n${fold(previewOf(bookmark.position, 500))}\n${fold(bookmark.note ?? "")}`;
  return (
    query.name.every((t) => name.includes(t)) &&
    query.path.every((t) => path.includes(t)) &&
    query.text.every((t) => all.includes(t))
  );
}

export function filterBookmarks(
  bookmarks: readonly LessonBookmark[],
  input: string,
): readonly LessonBookmark[] {
  const query = parseQuery(input);
  return isEmptyQuery(query) ? bookmarks : bookmarks.filter((b) => matchesQuery(b, query));
}
