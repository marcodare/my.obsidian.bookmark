import type { BookmarkPosition } from "../types";
import { extractHeadingPath } from "./capture";
import { clamp, findJunctions, lineEndOffset, lineStartOffset, posToOffset } from "./text";

export type RelocationMethod = "context" | "before" | "after" | "line";

export type ResolveResult =
  | { readonly kind: "exact"; readonly offset: number }
  | { readonly kind: "relocated"; readonly offset: number; readonly method: RelocationMethod }
  | { readonly kind: "ambiguous"; readonly candidates: readonly number[] }
  | { readonly kind: "notFound" };

/** A fragment shorter than this is too generic to identify a position. */
export const MIN_PROBE_LENGTH = 8;
const SHORT_CONTEXT = 24;

interface Probe {
  readonly before: string;
  readonly after: string;
  readonly method: RelocationMethod;
}

/** True for positions with no reference text at all (e.g. migrated from v0). */
export function lacksContext(position: BookmarkPosition): boolean {
  return (
    position.contextBefore.length === 0 &&
    position.contextAfter.length === 0 &&
    position.lineText.length === 0
  );
}

function isExactAt(text: string, position: BookmarkPosition): boolean {
  const { offset, contextBefore, contextAfter } = position;
  if (offset < 0 || offset > text.length) return false;
  return (
    text.slice(offset - contextBefore.length, offset) === contextBefore &&
    text.slice(offset, offset + contextAfter.length) === contextAfter
  );
}

function buildProbes(position: BookmarkPosition): Probe[] {
  const { contextBefore: before, contextAfter: after } = position;
  const shortBefore = before.slice(-SHORT_CONTEXT);
  const shortAfter = after.slice(0, SHORT_CONTEXT);
  const probes: Probe[] = [
    { before, after, method: "context" },
    { before, after: "", method: "before" },
    { before: "", after, method: "after" },
    { before: shortBefore, after: shortAfter, method: "context" },
    { before: shortBefore, after: "", method: "before" },
    { before: "", after: shortAfter, method: "after" },
  ];
  const seen = new Set<string>();
  return probes.filter((p) => {
    const key = `${p.before}\u0000${p.after}`;
    if (seen.has(key) || (p.before + p.after).trim().length < MIN_PROBE_LENGTH) return false;
    seen.add(key);
    return true;
  });
}

function sameHeadings(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/** Narrows candidates using headings; returns the original set if the filter removes them all. */
function disambiguate(text: string, position: BookmarkPosition, candidates: number[]): number[] {
  if (candidates.length <= 1) return candidates;
  const filtered = candidates.filter((c) =>
    sameHeadings(extractHeadingPath(text, c), position.headingPath),
  );
  return filtered.length > 0 ? filtered : candidates;
}

function findLineCandidates(text: string, position: BookmarkPosition): number[] {
  const target = position.lineText.trim();
  if (target.length < MIN_PROBE_LENGTH) return [];
  const result: number[] = [];
  let start = 0;
  while (start <= text.length) {
    const end = lineEndOffset(text, start);
    if (text.slice(start, end).trim() === target) {
      result.push(clamp(start + position.ch, start, end));
    }
    if (end >= text.length) break;
    start = end + 1;
  }
  return result;
}

/**
 * Finds a bookmark's position in the current document text.
 *
 * Never picks arbitrarily among several candidates: if the context occurs more than once
 * and the headings cannot tell them apart, it returns "ambiguous".
 */
export function resolvePosition(text: string, position: BookmarkPosition): ResolveResult {
  if (lacksContext(position) && text.length > 0) {
    // Bookmark migrated from a format without context: line/column is all we have.
    return { kind: "relocated", offset: posToOffset(text, position), method: "line" };
  }

  if (isExactAt(text, position)) {
    // Empty context (document was empty at creation): valid only if it still is.
    const hasContext = position.contextBefore.length + position.contextAfter.length > 0;
    if (hasContext || text.length === 0) return { kind: "exact", offset: position.offset };
  }

  let ambiguous: number[] | null = null;

  for (const probe of buildProbes(position)) {
    const found = disambiguate(text, position, findJunctions(text, probe.before, probe.after));
    if (found.length === 1) {
      return { kind: "relocated", offset: found[0] as number, method: probe.method };
    }
    if (found.length > 1 && ambiguous === null) ambiguous = found;
  }

  const lines = disambiguate(text, position, findLineCandidates(text, position));
  if (lines.length === 1) return { kind: "relocated", offset: lines[0] as number, method: "line" };
  if (lines.length > 1 && ambiguous === null) ambiguous = lines;

  return ambiguous ? { kind: "ambiguous", candidates: ambiguous } : { kind: "notFound" };
}

/** Line start offset for a saved line, clamped to the document length. */
export function fallbackOffset(text: string, position: BookmarkPosition): number {
  return lineStartOffset(text, position.line);
}
