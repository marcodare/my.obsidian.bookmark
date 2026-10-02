import { describe, expect, it } from "vitest";
import { findRelinkCandidates, type RelinkSource } from "../src/anchor/relink";
import { LESSON, storeWith } from "./helpers";

const ORIGINAL = "Linux/modulo00/lezione01/lesson.md";
const { bookmarks } = storeWith([
  { filePath: ORIGINAL, name: "Policy", text: LESSON, marker: "basate sulla " },
]);
const bookmark = bookmarks[0]!;

function vault(files: Record<string, string>): RelinkSource {
  return {
    markdownPaths: Object.keys(files),
    readFile: async (path) => {
      const content = files[path];
      if (content === undefined) throw new Error("missing");
      return content;
    },
  };
}

describe("relinking orphaned bookmarks", () => {
  it("file moved to another folder (same name)", async () => {
    const source = vault({
      "Archivio/Linux/modulo00/lezione01/lesson.md": LESSON,
      "Networking/modulo00/lezione01/lesson.md": "# Altra lezione\n\nNiente di simile.",
    });
    const candidates = await findRelinkCandidates(bookmark, source, false);
    expect(candidates.map((c) => c.path)).toEqual(["Archivio/Linux/modulo00/lezione01/lesson.md"]);
    expect(candidates[0]!.result.kind).toBe("exact");
  });

  it("renamed file: found only by the deep search", async () => {
    const source = vault({ "Linux/modulo00/lezione01/routing.md": `Nuova intro.\n${LESSON}` });
    expect(await findRelinkCandidates(bookmark, source, false)).toEqual([]);
    const deep = await findRelinkCandidates(bookmark, source, true);
    expect(deep.map((c) => [c.path, c.result.kind, c.sameName])).toEqual([
      ["Linux/modulo00/lezione01/routing.md", "relocated", false],
    ]);
  });

  it("missing file: no candidate", async () => {
    const source = vault({ "Cloud/modulo00/lezione01/lesson.md": "# Cloud\n\nContenuto diverso." });
    expect(await findRelinkCandidates(bookmark, source, true)).toEqual([]);
  });
});
