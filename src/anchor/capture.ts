import type { BookmarkPosition, PositionSource } from "../types";
import { clamp, lineAt, offsetToPos } from "./text";

export const CONTEXT_LENGTH = 64;
const MAX_LINE_TEXT = 300;

const HEADING_RE = /^(#{1,6})[ \t]+(.*?)[ \t]*#*[ \t]*$/;
const FENCE_RE = /^[ \t]{0,3}(`{3,}|~{3,})/;

/** Headings containing `offset`, ignoring frontmatter and code blocks. */
export function extractHeadingPath(text: string, offset: number): string[] {
  const upTo = text.slice(0, clamp(offset, 0, text.length));
  const lines = upTo.split("\n");
  const stack: { level: number; title: string }[] = [];
  let fence: string | null = null;
  let index = 0;

  if (lines[0] === "---") {
    const end = lines.indexOf("---", 1);
    index = end === -1 ? lines.length : end + 1;
  }

  for (; index < lines.length; index++) {
    const line = lines[index] as string;
    const fenceMatch = FENCE_RE.exec(line);
    if (fenceMatch) {
      const marker = (fenceMatch[1] as string)[0] as string;
      if (fence === null) fence = marker;
      else if (fence === marker) fence = null;
      continue;
    }
    if (fence !== null) continue;
    const heading = HEADING_RE.exec(line);
    if (!heading) continue;
    const level = (heading[1] as string).length;
    while (stack.length > 0 && (stack[stack.length - 1] as { level: number }).level >= level) {
      stack.pop();
    }
    stack.push({ level, title: heading[2] as string });
  }
  return stack.map((h) => h.title);
}

/** Creates a position with context from the document text and an offset. */
export function capturePosition(
  text: string,
  offset: number,
  source: PositionSource,
): BookmarkPosition {
  const safe = clamp(offset, 0, text.length);
  const { line, ch } = offsetToPos(text, safe);
  return {
    line,
    ch,
    offset: safe,
    contextBefore: text.slice(Math.max(0, safe - CONTEXT_LENGTH), safe),
    contextAfter: text.slice(safe, safe + CONTEXT_LENGTH),
    lineText: lineAt(text, safe).slice(0, MAX_LINE_TEXT),
    headingPath: extractHeadingPath(text, safe),
    source,
  };
}

/** Updates offset/line/column while keeping the original context. */
export function withOffset(
  text: string,
  position: BookmarkPosition,
  offset: number,
): BookmarkPosition {
  const safe = clamp(offset, 0, text.length);
  const { line, ch } = offsetToPos(text, safe);
  return { ...position, offset: safe, line, ch };
}

/** Short text shown in the sidebar. */
export function previewOf(position: BookmarkPosition, maxLength = 120): string {
  const line = position.lineText.trim();
  const source =
    line.length > 0 ? line : position.contextAfter.trim() || position.contextBefore.trim();
  const flat = source.replace(/\s+/g, " ");
  return flat.length > maxLength ? `${flat.slice(0, maxLength - 1)}…` : flat;
}
