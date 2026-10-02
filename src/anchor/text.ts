/** Utility pure sul testo del documento. Tutti gli offset si riferiscono a testo con "\n". */

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

/** Tutte le occorrenze (anche sovrapposte) di `needle` in `text`. */
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
  /** map[i] = offset originale del carattere i del testo normalizzato; map[text.length] = fine. */
  readonly map: readonly number[];
}

/** Comprime ogni sequenza di spazi bianchi (inclusi "\n") in un singolo spazio. */
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
 * Cerca `before + after` nel testo e restituisce gli offset del punto di giunzione.
 * Prova prima la corrispondenza esatta, poi quella con spazi bianchi normalizzati.
 */
export function findJunctions(text: string, before: string, after: string): number[] {
  const exact = findAll(text, before + after).map((i) => i + before.length);
  if (exact.length > 0) return exact;

  const haystack = normalizeWhitespace(text);
  const normBefore = normalizeWhitespace(before).text;
  const needle = normalizeWhitespace(before + after).text;
  // Se `before` termina e `after` inizia con spazi, nel needle collassano in uno solo.
  const split = Math.min(normBefore.length, needle.length);
  return findAll(haystack.text, needle).map((i) => haystack.map[i + split] ?? text.length);
}
