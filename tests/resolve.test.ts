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

/** Offset atteso nel nuovo testo: subito dopo lo stesso marker. */
function expected(text: string, marker = MARKER): number {
  return offsetAfter(text, marker);
}

describe("capturePosition", () => {
  it("salva riga, colonna, contesto e titoli", () => {
    const pos = bookmarkAt(LESSON, MARKER);
    expect(pos.line).toBe(offsetToPos(LESSON, pos.offset).line);
    expect(pos.contextBefore.endsWith(MARKER)).toBe(true);
    expect(pos.contextAfter.startsWith("sorgente del pacchetto")).toBe(true);
    expect(pos.lineText).toContain("Con ip rule");
    expect(pos.headingPath).toEqual(["Routing", "Policy routing"]);
  });

  it("ignora titoli dentro blocchi di codice e frontmatter", () => {
    const text = "---\ntitle: x\n---\n# A\n```\n# non titolo\n```\n## B\ntesto";
    expect(extractHeadingPath(text, text.length)).toEqual(["A", "B"]);
  });
});

describe("resolvePosition", () => {
  it("riconosce la posizione esatta", () => {
    const pos = bookmarkAt(LESSON, MARKER);
    expect(resolvePosition(LESSON, pos)).toEqual({ kind: "exact", offset: pos.offset });
  });

  it("recupera la posizione se il testo prima del bookmark è cambiato", () => {
    const pos = bookmarkAt(LESSON, MARKER);
    const edited = LESSON.replace("Il routing statico", "Il routing statico (configurato a mano)");
    const result = resolvePosition(edited, pos);
    expect(result).toEqual({ kind: "relocated", offset: expected(edited), method: "context" });
  });

  it("recupera la posizione dopo inserimento di righe", () => {
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

  it("recupera la posizione dopo cancellazione di righe", () => {
    const pos = bookmarkAt(LESSON, MARKER);
    const edited = LESSON.replace(
      "Il routing statico usa la tabella principale del kernel.\n\n",
      "",
    );
    const result = resolvePosition(edited, pos);
    expect(result).toMatchObject({ kind: "relocated", offset: expected(edited) });
  });

  it("recupera con il solo contesto precedente se il testo dopo è cambiato", () => {
    const pos = bookmarkAt(LESSON, MARKER);
    const edited = LESSON.replace(
      "sorgente del pacchetto.\nLe tabelle aggiuntive",
      "destinazione.\nAltre tabelle",
    );
    const result = resolvePosition(edited, pos);
    expect(result).toEqual({ kind: "relocated", offset: expected(edited), method: "before" });
  });

  it("tollera differenze di spazi e fine riga CRLF", () => {
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

  it("con contesto duplicato usa i titoli per scegliere", () => {
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

  it("con contesto duplicato e indistinguibile non sceglie da solo", () => {
    const block =
      "\n\nRipeti questo comando dopo ogni modifica alla configurazione: systemctl reload.\n\n";
    const text = `# Note${block}---${block}`;
    const pos = capturePosition(text, text.indexOf("systemctl"), "editor");
    // Il bookmark punta al primo blocco; il separatore che lo distingueva è stato cambiato.
    const edited = text.replace("---", "***");
    const result = resolvePosition(edited, pos);
    expect(result.kind).toBe("ambiguous");
    expect(result.kind === "ambiguous" && result.candidates.length).toBe(2);
  });

  it("restituisce notFound se il testo è stato rimosso", () => {
    const pos = bookmarkAt(LESSON, MARKER);
    const start = LESSON.indexOf("## Policy routing");
    const end = LESSON.indexOf("## Esempio pratico");
    const edited = LESSON.slice(0, start) + LESSON.slice(end);
    expect(resolvePosition(edited, pos)).toEqual({ kind: "notFound" });
  });

  it("non sposta bookmark migrati senza contesto oltre la riga salvata", () => {
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
