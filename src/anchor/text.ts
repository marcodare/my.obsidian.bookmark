/** Pure helpers on document text. Every offset refers to text with "\n" line endings. */

export interface LineCh {
  readonly line: number;
  readonly ch: number;
}

export function normalizeNewlines(text: string): string {
  return text.replace(/\r\n?/g, "\n");
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function offsetToPos(text: string, offset: number): LineCh {
  const safe = clamp(offset, 0, text.length);
  let line = 0;
  let lineStart = 0;
  for (let i = 0; i < safe; i++) {
    if (text.charCodeAt(i) === 10) {
      line++;
      lineStart = i + 1;
    }
  }
  return { line, ch: safe - lineStart };
}

export function lineStartOffset(text: string, line: number): number {
  if (line <= 0) return 0;
  let current = 0;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) {
      current++;
      if (current === line) return i + 1;
    }
  }
  return text.length;
}

export function posToOffset(text: string, pos: LineCh): number {
  const start = lineStartOffset(text, pos.line);
  const end = lineEndOffset(text, start);
  return clamp(start + pos.ch, start, end);
}

export function lineEndOffset(text: string, offsetInLine: number): number {
  const end = text.indexOf("\n", offsetInLine);
  return end === -1 ? text.length : end;
}

export function lineAt(text: string, offset: number): string {
  const safe = clamp(offset, 0, text.length);
  const start = text.lastIndexOf("\n", safe - 1) + 1;
  return text.slice(start, lineEndOffset(text, safe));
}

export function lineCount(text: string): number {
  let count = 1;
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) count++;
  return count;
}

/** Every occurrence (overlapping too) of `needle` in `text`. */
export function findAll(text: string, needle: string): number[] {
  if (needle.length === 0) return [];
  const result: number[] = [];
  let from = 0;
  for (;;) {
    const index = text.indexOf(needle, from);
    if (index === -1) return result;
    result.push(index);
    from = index + 1;
  }
}

interface NormalizedText {
  readonly text: string;
  /** map[i] = original offset of character i of the normalized text; map[text.length] = end. */
  readonly map: readonly number[];
}

/** Collapses every whitespace run (including "\n") into a single space. */
export function normalizeWhitespace(text: string): NormalizedText {
  let out = "";
  const map: number[] = [];
  let inSpace = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i] as string;
    if (/\s/.test(c)) {
      if (!inSpace) {
        out += " ";
        map.push(i);
        inSpace = true;
      }
    } else {
      out += c;
      map.push(i);
      inSpace = false;
    }
  }
  map.push(text.length);
  return { text: out, map };
}

/**
 * Searches `before + after` in the text and returns the offsets of the join point.
 * Tries an exact match first, then one with normalized whitespace.
 */
export function findJunctions(text: string, before: string, after: string): number[] {
  const exact = findAll(text, before + after).map((i) => i + before.length);
  if (exact.length > 0) return exact;

  const haystack = normalizeWhitespace(text);
  const normBefore = normalizeWhitespace(before).text;
  const needle = normalizeWhitespace(before + after).text;
  // If `before` ends and `after` starts with whitespace, they collapse into one in the needle.
  const split = Math.min(normBefore.length, needle.length);
  return findAll(haystack.text, needle).map((i) => haystack.map[i + split] ?? text.length);
}
