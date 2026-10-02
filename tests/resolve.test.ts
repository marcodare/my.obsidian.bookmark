import { describe, expect, it } from "vitest";
import { capturePosition, extractHeadingPath } from "../src/anchor/capture";
import { lacksContext, resolvePosition } from "../src/anchor/resolve";
import { normalizeNewlines, offsetToPos } from "../src/anchor/text";
import type { BookmarkPosition } from "../src/types";
import { LESSON, offsetAfter } from "./helpers";

const MARKER = "basate sulla ";

function bookmarkAt(text: string, marker: string): BookmarkPosition {
  return capturePosition(text, offsetAfter(text, marker), "editor");
}

/** Expected offset in the new text: right after the same marker. */
function expected(text: string, marker = MARKER): number {
  return offsetAfter(text, marker);
}

describe("capturePosition", () => {
  it("stores line, column, context and headings", () => {
    const pos = bookmarkAt(LESSON, MARKER);
    expect(pos.line).toBe(offsetToPos(LESSON, pos.offset).line);
    expect(pos.contextBefore.endsWith(MARKER)).toBe(true);
    expect(pos.contextAfter.startsWith("sorgente del pacchetto")).toBe(true);
    expect(pos.lineText).toContain("Con ip rule");
    expect(pos.headingPath).toEqual(["Routing", "Policy routing"]);
  });

  it("ignores headings inside code blocks and frontmatter", () => {
    const text = "---\ntitle: x\n---\n# A\n```\n# non titolo\n```\n## B\ntesto";
    expect(extractHeadingPath(text, text.length)).toEqual(["A", "B"]);
  });
});

describe("resolvePosition", () => {
  it("recognizes the exact position", () => {
    const pos = bookmarkAt(LESSON, MARKER);
    expect(resolvePosition(LESSON, pos)).toEqual({ kind: "exact", offset: pos.offset });
  });

  it("recovers the position when the text before the bookmark changed", () => {
    const pos = bookmarkAt(LESSON, MARKER);
    const edited = LESSON.replace("Il routing statico", "Il routing statico (configurato a mano)");
    const result = resolvePosition(edited, pos);
    expect(result).toEqual({ kind: "relocated", offset: expected(edited), method: "context" });
  });

  it("recovers the position after lines are inserted", () => {
    const pos = bookmarkAt(LESSON, MARKER);
    const edited = LESSON.replace(
      "# Routing\n",
      "# Routing\n\nRiga nuova 1.\nRiga nuova 2.\nRiga nuova 3.\n",
    );
    const result = resolvePosition(edited, pos);
    expect(result.kind).toBe("relocated");
    expect(result.kind === "relocated" && result.offset).toBe(expected(edited));
    expect(offsetToPos(edited, expected(edited)).line).toBe(pos.line + 4);
  });

  it("recovers the position after lines are deleted", () => {
    const pos = bookmarkAt(LESSON, MARKER);
    const edited = LESSON.replace(
      "Il routing statico usa la tabella principale del kernel.\n\n",
      "",
    );
    const result = resolvePosition(edited, pos);
    expect(result).toMatchObject({ kind: "relocated", offset: expected(edited) });
  });

  it("recovers with the preceding context alone when the text after changed", () => {
    const pos = bookmarkAt(LESSON, MARKER);
    const edited = LESSON.replace(
      "sorgente del pacchetto.\nLe tabelle aggiuntive",
      "destinazione.\nAltre tabelle",
    );
    const result = resolvePosition(edited, pos);
    expect(result).toEqual({ kind: "relocated", offset: expected(edited), method: "before" });
  });

  it("tolerates whitespace differences and CRLF line endings", () => {
    const pos = bookmarkAt(LESSON, MARKER);
    const crlf = normalizeNewlines(
      LESSON.replace(/\n/g, "\r\n").replace("basate sulla", "basate  sulla"),
    );
    const result = resolvePosition(crlf, pos);
    expect(result.kind).toBe("relocated");
    expect(result.kind === "relocated" && crlf.slice(result.offset).startsWith("sorgente")).toBe(
      true,
    );
  });

  it("with duplicated context uses headings to choose", () => {
    const block =
      "Ripeti questo comando dopo ogni modifica alla configurazione: systemctl reload.\n";
    const text = `# Linux\n\n## Rete\n\n${block}\n## Firewall\n\n${block}`;
    const firewallOffset = text.lastIndexOf("systemctl");
    const pos = capturePosition(text, firewallOffset, "editor");
    const edited = `Introduzione aggiunta.\n${text}`;
    expect(resolvePosition(edited, pos)).toMatchObject({
      kind: "relocated",
      offset: edited.lastIndexOf("systemctl"),
    });
  });

  it("with duplicated, indistinguishable context it does not choose", () => {
    const block =
      "\n\nRipeti questo comando dopo ogni modifica alla configurazione: systemctl reload.\n\n";
    const text = `# Note${block}---${block}`;
    const pos = capturePosition(text, text.indexOf("systemctl"), "editor");
    // The bookmark points at the first block; the separator that told it apart was changed.
    const edited = text.replace("---", "***");
    const result = resolvePosition(edited, pos);
    expect(result.kind).toBe("ambiguous");
    expect(result.kind === "ambiguous" && result.candidates.length).toBe(2);
  });

  it("returns notFound when the text was removed", () => {
    const pos = bookmarkAt(LESSON, MARKER);
    const start = LESSON.indexOf("## Policy routing");
    const end = LESSON.indexOf("## Esempio pratico");
    const edited = LESSON.slice(0, start) + LESSON.slice(end);
    expect(resolvePosition(edited, pos)).toEqual({ kind: "notFound" });
  });

  it("does not move migrated bookmarks without context past the saved line", () => {
    const legacy: BookmarkPosition = {
      line: 5,
      ch: 3,
      offset: 0,
      contextBefore: "",
      contextAfter: "",
      lineText: "",
      headingPath: [],
      source: "editor",
    };
    expect(lacksContext(legacy)).toBe(true);
    const result = resolvePosition(LESSON, legacy);
    expect(result.kind).toBe("relocated");
    expect(result.kind === "relocated" && offsetToPos(LESSON, result.offset)).toEqual({
      line: 5,
      ch: 3,
    });
  });
});
