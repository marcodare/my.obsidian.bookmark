import { describe, expect, it } from "vitest";
import { capturePosition } from "../src/anchor/capture";
import { createBookmark, deleteBookmark, renameBookmark } from "../src/store/operations";
import { StoreManager } from "../src/store/StoreManager";
import type { BookmarkStore } from "../src/types";
import { LESSON, MemoryIO, T0, T1, T2, idFactory, storeWith } from "./helpers";

function manager(io: MemoryIO, clock = () => T2) {
  const messages: string[] = [];
  const m = new StoreManager({
    io,
    clock,
    newId: idFactory("x"),
    notify: (msg) => messages.push(msg),
  });
  return { m, messages };
}

const position = capturePosition(LESSON, 10, "editor");
const add = (name: string, id: string) => (s: BookmarkStore) =>
  createBookmark(s, { filePath: "Linux/a.md", name, position }, T2, id).store;

describe("StoreManager", () => {
  it("saves to data.json and reloads after a restart", async () => {
    const io = new MemoryIO();
    const first = manager(io).m;
    await first.load();
    first.update(add("Da riprendere", "a"));
    await first.flush();

    const second = manager(io).m;
    await second.load();
    expect(second.store.bookmarks.map((b) => b.name)).toEqual(["Da riprendere"]);
  });

  it("does not lose bookmarks created on another device before the write", async () => {
    const { store: initial } = storeWith([
      { filePath: "Linux/a.md", name: "A", text: LESSON, marker: "ip rule" },
    ]);
    const io = new MemoryIO(JSON.stringify(initial));
    const { m } = manager(io);
    await m.load();

    // Sync writes a new bookmark into the file while Obsidian is open.
    const remote = createBookmark(
      initial,
      { filePath: "Cloud/b.md", name: "Remoto", position },
      T1,
      "remote",
    ).store;
    io.raw = JSON.stringify(remote);

    m.update(add("Locale", "local"));
    await m.flush();
    const saved = JSON.parse(io.raw!) as BookmarkStore;
    expect(saved.bookmarks.map((b) => b.name).sort()).toEqual(["A", "Locale", "Remoto"]);
    expect(m.store.bookmarks).toHaveLength(3);
  });

  it("reloads external changes (rename and delete on another device)", async () => {
    const { store: initial, bookmarks } = storeWith([
      { filePath: "Linux/a.md", name: "A", text: LESSON, marker: "ip rule" },
      { filePath: "Linux/a.md", name: "B", text: LESSON, marker: "kernel" },
    ]);
    const io = new MemoryIO(JSON.stringify(initial));
    const { m } = manager(io);
    await m.load();

    let remote = renameBookmark(initial, bookmarks[0]!.id, "A rinominato", T1);
    remote = deleteBookmark(remote, bookmarks[1]!.id, T1);
    io.raw = JSON.stringify(remote);
    const savesBefore = io.saves;

    await m.reloadFromDisk();
    expect(m.store.bookmarks.map((b) => b.name)).toEqual(["A rinominato"]);
    expect(io.saves).toBe(savesBefore); // nothing to rewrite
  });

  it("rejects edits while read-only (newer data.json)", async () => {
    const io = new MemoryIO(JSON.stringify({ version: 7, bookmarks: [] }));
    const { m, messages } = manager(io);
    await m.load();
    expect(m.isReadOnly).toBe(true);
    expect(m.update(add("X", "x"))).toBe(false);
    expect(io.saves).toBe(0);
    expect(messages.length).toBeGreaterThan(0);
  });

  it("concurrent writes do not overwrite each other", async () => {
    const io = new MemoryIO();
    const { m } = manager(io, () => T0);
    await m.load();
    m.update(add("Uno", "1"));
    m.update(add("Due", "2"));
    m.update(add("Tre", "3"));
    await m.flush();
    expect((JSON.parse(io.raw!) as BookmarkStore).bookmarks).toHaveLength(3);
  });
});
