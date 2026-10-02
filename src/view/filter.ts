import { previewOf } from "../anchor/capture";
import type { Bookmark } from "../types";

export interface SearchQuery {
  /** Terms searched in name, path, preview and note. */
  readonly text: readonly string[];
  readonly name: readonly string[];
  readonly path: readonly string[];
}

/** Lowercase without accents, for lenient comparisons. */
export function fold(value: string): string {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

const TOKEN_RE = /(\w+:)?(?:"([^"]*)"|(\S+))/g;

/**
 * Parses the search query. Syntax:
 *   policy routing          → both terms, anywhere
 *   name:"to review"        → name only
 *   path:linux file:lesson  → path only
 */
export function parseQuery(input: string): SearchQuery {
  const text: string[] = [];
  const name: string[] = [];
  const path: string[] = [];
  for (const match of input.matchAll(TOKEN_RE)) {
    const prefix = match[1]?.toLowerCase();
    const value = fold(match[2] ?? match[3] ?? "").trim();
    if (value.length === 0) continue;
    if (prefix === "name:") name.push(value);
    else if (prefix === "path:" || prefix === "file:") path.push(value);
    else text.push(fold(match[0].replace(/"/g, "")));
  }
  return { text, name, path };
}

export function isEmptyQuery(q: SearchQuery): boolean {
  return q.text.length === 0 && q.name.length === 0 && q.path.length === 0;
}

export function matchesQuery(bookmark: Bookmark, query: SearchQuery): boolean {
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
  bookmarks: readonly Bookmark[],
  input: string,
): readonly Bookmark[] {
  const query = parseQuery(input);
  return isEmptyQuery(query) ? bookmarks : bookmarks.filter((b) => matchesQuery(b, query));
}
