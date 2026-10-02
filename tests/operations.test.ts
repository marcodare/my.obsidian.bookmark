import { describe, expect, it } from "vitest";
import { capturePosition } from "../src/anchor/capture";
import {
  createBookmark,
  deleteBookmark,
  duplicateBookmark,
  editBookmark,
  findByFileAndName,
  healBookmarkPosition,
  markDeletedPath,
  moveBookmark,
  moveBookmarkBefore,
  relinkPaths,
  renameBookmark,
  updateBookmarkPosition,
} from "../src/store/operations";
import { createEmptyStore } from "../src/types";
import { LESSON, T0, T1, offsetAfter, storeWith } from "./helpers";

const LINUX = "Linux/modulo00/lezione01/lesson.md";
const NET = "Networking/modulo01/lezione02/lesson.md";

describe("create", () => {
  it("creates a bookmark with name, file, position and dates", () => {
    const position = capturePosition(LESSON, offsetAfter(LESSON, "ip rule "), "editor");
    const { store, bookmark } = createBookmark(
      createEmptyStore(),
      { filePath: LINUX, name: "  Policy   routing ", position },
      T0,
      "a",
    );
    expect(store.bookmarks).toHaveLength(1);
    expect(bookmark).toMatchObject({
      id: "a",
      filePath: LINUX,
      name: "Policy routing",
      status: "ok",
      createdAt: T0,
      updatedAt: T0,
      order: 0,
    });
    expect(bookmark.position.offset).toBe(position.offset);
  });

  it("rejects empty names", () => {
    const position = capturePosition(LESSON, 0, "editor");
    expect(() =>
      createBookmark(createEmptyStore(), { filePath: LINUX, name: "   ", position }, T0, "a"),
    ).toThrow();
  });

  it("finds an existing bookmark with the same name in the same file", () => {
    const { store } = storeWith([
      { filePath: LINUX, name: "Da riprendere", text: LESSON, marker: "ip rule" },
    ]);
    expect(findByFileAndName(store, LINUX, "da RIPRENDERE")).toBeDefined();
    expect(findByFileAndName(store, NET, "Da riprendere")).toBeUndefined();
  });

  it("does not mutate the original store", () => {
    const empty = createEmptyStore();
    createBookmark(
      empty,
      { filePath: LINUX, name: "x", position: capturePosition("", 0, "editor") },
      T0,
      "a",
    );
    expect(empty.bookmarks).toHaveLength(0);
  });
});

describe("update, rename, delete", () => {
  it("updates position, context and updatedAt", () => {
    const { store, bookmarks } = storeWith([
      { filePath: LINUX, name: "A", text: LESSON, marker: "ip rule" },
    ]);
    const newPos = capturePosition(LESSON, offsetAfter(LESSON, "table 100"), "editor");
    const updated = updateBookmarkPosition(store, bookmarks[0]!.id, LINUX, newPos, T1);
    expect(updated.bookmarks[0]).toMatchObject({ position: newPos, updatedAt: T1, createdAt: T0 });
  });

  it("an automatic fix does not change updatedAt", () => {
    const { store, bookmarks } = storeWith([
      { filePath: LINUX, name: "A", text: LESSON, marker: "ip rule" },
    ]);
    const healed = healBookmarkPosition(store, bookmarks[0]!.id, bookmarks[0]!.position, T1);
    expect(healed.bookmarks[0]).toMatchObject({ updatedAt: T0, revisedAt: T1 });
  });

  it("renames", () => {
    const { store, bookmarks } = storeWith([
      { filePath: LINUX, name: "A", text: LESSON, marker: "ip rule" },
    ]);
    const renamed = renameBookmark(store, bookmarks[0]!.id, "Concetto importante", T1);
    expect(renamed.bookmarks[0]).toMatchObject({ name: "Concetto importante", updatedAt: T1 });
    expect(() => renameBookmark(store, bookmarks[0]!.id, "", T1)).toThrow();
  });

  it("deletes and leaves a tombstone", () => {
    const { store, bookmarks } = storeWith([
      { filePath: LINUX, name: "A", text: LESSON, marker: "ip rule" },
      { filePath: NET, name: "B", text: LESSON, marker: "kernel" },
    ]);
    const deleted = deleteBookmark(store, bookmarks[0]!.id, T1);
    expect(deleted.bookmarks.map((b) => b.name)).toEqual(["B"]);
    expect(deleted.tombstones).toEqual([{ id: bookmarks[0]!.id, deletedAt: T1 }]);
  });

  it("duplicates right after the original with a unique name", () => {
    const { store, bookmarks } = storeWith([
      { filePath: LINUX, name: "A", text: LESSON, marker: "ip rule" },
      { filePath: LINUX, name: "B", text: LESSON, marker: "kernel" },
    ]);
    const first = duplicateBookmark(store, bookmarks[0]!.id, T1, "c1");
    const second = duplicateBookmark(first.store, bookmarks[0]!.id, T1, "c2");
    expect(first.bookmark.name).toBe("A (copy)");
    expect(second.bookmark.name).toBe("A (copy 2)");
    const ordered = [...second.store.bookmarks]
      .sort((a, b) => a.order - b.order)
      .map((b) => b.name);
    expect(ordered).toEqual(["A", "A (copy 2)", "A (copy)", "B"]);
  });
});

describe("manual order", () => {
  const setup = () =>
    storeWith([
      { filePath: LINUX, name: "A", text: LESSON, marker: "Routing" },
      { filePath: LINUX, name: "B", text: LESSON, marker: "kernel" },
      { filePath: LINUX, name: "C", text: LESSON, marker: "ip rule" },
    ]);
  const names = (s: ReturnType<typeof setup>["store"]) =>
    [...s.bookmarks].sort((a, b) => a.order - b.order).map((b) => b.name);

  it("moves up and down within the group", () => {
    const { store, bookmarks } = setup();
    const peers = bookmarks.map((b) => b.id);
    expect(names(moveBookmark(store, bookmarks[2]!.id, peers, -1, T1))).toEqual(["A", "C", "B"]);
    expect(names(moveBookmark(store, bookmarks[0]!.id, peers, -1, T1))).toEqual(["A", "B", "C"]);
  });

  it("moves before another bookmark (drag & drop)", () => {
    const { store, bookmarks } = setup();
    const peers = bookmarks.map((b) => b.id);
    expect(names(moveBookmarkBefore(store, bookmarks[2]!.id, bookmarks[0]!.id, peers, T1))).toEqual(
      ["C", "A", "B"],
    );
    expect(names(moveBookmarkBefore(store, bookmarks[0]!.id, null, peers, T1))).toEqual([
      "B",
      "C",
      "A",
    ]);
  });
});

describe("renamed, moved, deleted files", () => {
  it("renamed file: updates the path", () => {
    const { store } = storeWith([{ filePath: LINUX, name: "A", text: LESSON, marker: "ip rule" }]);
    const renamed = relinkPaths(store, LINUX, "Linux/modulo00/lezione01/routing.md", T1);
    expect(renamed.bookmarks[0]!.filePath).toBe("Linux/modulo00/lezione01/routing.md");
  });

  it("moved folder: updates every contained file", () => {
    const { store } = storeWith([
      { filePath: LINUX, name: "A", text: LESSON, marker: "ip rule" },
      { filePath: "Linux/modulo00/lezione02/lesson.md", name: "B", text: LESSON, marker: "kernel" },
      { filePath: "Linux/modulo000/x.md", name: "C", text: LESSON, marker: "kernel" },
    ]);
    const moved = relinkPaths(store, "Linux/modulo00", "Archivio/Linux/modulo00", T1);
    expect(moved.bookmarks.map((b) => b.filePath)).toEqual([
      "Archivio/Linux/modulo00/lezione01/lesson.md",
      "Archivio/Linux/modulo00/lezione02/lesson.md",
      "Linux/modulo000/x.md",
    ]);
  });

  it("deleted file: the bookmark becomes orphaned but is not deleted", () => {
    const { store } = storeWith([{ filePath: LINUX, name: "A", text: LESSON, marker: "ip rule" }]);
    const marked = markDeletedPath(store, LINUX, T1);
    expect(marked.bookmarks[0]!.status).toBe("orphan");
    const restored = relinkPaths(marked, LINUX, "Altro/lesson.md", T1);
    expect(restored.bookmarks[0]!.status).toBe("ok");
  });
});

describe("notes", () => {
  const position = capturePosition(LESSON, offsetAfter(LESSON, "ip rule "), "editor");

  it("saves the trimmed note and omits it when empty", () => {
    const withNote = createBookmark(
      createEmptyStore(),
      { filePath: LINUX, name: "a", note: "  riga 1\r\nriga 2  ", position },
      T0,
      "a",
    ).bookmark;
    expect(withNote.note).toBe("riga 1\nriga 2");
    const empty = createBookmark(
      createEmptyStore(),
      { filePath: LINUX, name: "a", note: "   ", position },
      T0,
      "a",
    ).bookmark;
    expect("note" in empty).toBe(false);
  });

  it("edits name and note, removing a cleared note", () => {
    const { store, bookmark } = createBookmark(
      createEmptyStore(),
      { filePath: LINUX, name: "a", note: "vecchia", position },
      T0,
      "a",
    );
    const edited = editBookmark(store, bookmark.id, { name: " b ", note: "nuova" }, T1);
    expect(edited.bookmarks[0]).toMatchObject({ name: "b", note: "nuova", updatedAt: T1 });
    const cleared = editBookmark(edited, bookmark.id, { name: "b", note: "" }, T1);
    expect("note" in cleared.bookmarks[0]!).toBe(false);
    expect(() => editBookmark(store, bookmark.id, { name: " ", note: "" }, T1)).toThrow();
  });
});
