import { describe, expect, it } from "vitest";
import { migrate } from "../src/store/migrations";
import {
  deleteBookmark,
  healBookmarkPosition,
  markDeletedPath,
  renameBookmark,
  updateBookmarkPosition,
} from "../src/store/operations";
import { loadStore, mergeStores, readRemote } from "../src/store/persistence";
import { createEmptyStore, CURRENT_STORE_VERSION } from "../src/types";
import { LESSON, MemoryIO, T0, T1, T2, idFactory, storeWith } from "./helpers";

const ctx = { now: T2, newId: idFactory("new") };
const LINUX = "Linux/modulo00/lezione01/lesson.md";

describe("save and load", () => {
  it("missing file → empty store without warnings", async () => {
    const outcome = await loadStore(new MemoryIO(null), ctx);
    expect(outcome).toEqual({ kind: "ok", store: createEmptyStore(), warnings: [] });
  });

  it("JSON round-trip without data loss", async () => {
    const { store } = storeWith([
      { filePath: LINUX, name: "Da riprendere", text: LESSON, marker: "ip rule" },
      {
        filePath: "Cloud/modulo00/lezione01/lesson.md",
        name: "Esempio pratico",
        text: LESSON,
        marker: "kernel",
      },
    ]);
    const io = new MemoryIO();
    await io.save(store);
    const outcome = await loadStore(io, ctx);
    expect(outcome.kind).toBe("ok");
    expect(outcome.store).toEqual(store);
    expect(outcome.warnings).toEqual([]);
    expect(io.backups.size).toBe(0);
  });

  it("missing or invalid settings fall back to defaults", async () => {
    const io = new MemoryIO(
      JSON.stringify({
        version: 1,
        bookmarks: [],
        tombstones: [],
        settings: { grouping: "boh", sort: "name" },
      }),
    );
    const outcome = await loadStore(io, ctx);
    expect(outcome.store.settings.grouping).toBe("pathTree");
    expect(outcome.store.settings.sort).toBe("name");
  });
});

describe("migration", () => {
  const v0 = {
    bookmarks: [
      { id: "old-1", file: LINUX, name: "Da verificare", line: 9, ch: 2, createdAt: T0 },
      { filePath: "Networking/a.md", name: "Senza id", line: 0 },
      { name: "Senza file", line: 3 },
    ],
  };

  it("converts v0 → v1", () => {
    const result = migrate(v0, ctx);
    expect(result.migratedFrom).toBe(0);
    expect(result.droppedEntries).toBe(1);
    expect(result.store.version).toBe(CURRENT_STORE_VERSION);
    expect(result.store.bookmarks).toHaveLength(2);
    expect(result.store.bookmarks[0]).toMatchObject({
      id: "old-1",
      filePath: LINUX,
      position: { line: 9, ch: 2, contextBefore: "" },
      createdAt: T0,
      updatedAt: T0,
    });
    expect(result.store.bookmarks[1]!.id).toMatch(/^new-/);
  });

  it("backs up the original file before saving the migrated version", async () => {
    const original = JSON.stringify(v0);
    const io = new MemoryIO(original);
    const outcome = await loadStore(io, ctx);
    expect(outcome.warnings[0]).toContain("format v0");
    const [name, content] = [...io.backups.entries()][0]!;
    expect(name).toMatch(/^data\.backup-v0-/);
    expect(content).toBe(original);
    expect(JSON.parse(io.raw!).version).toBe(1);
  });

  it("a newer format is not overwritten", async () => {
    const io = new MemoryIO(JSON.stringify({ version: 99, bookmarks: [] }));
    const outcome = await loadStore(io, ctx);
    expect(outcome.kind).toBe("readOnly");
    expect(io.saves).toBe(0);
    expect(await readRemote(io, ctx)).toEqual({ kind: "newer", version: 99 });
  });
});

describe("corrupt data", () => {
  it("invalid JSON: backs up the content and starts over", async () => {
    const io = new MemoryIO('{"version": 1, "bookmarks": [');
    const outcome = await loadStore(io, ctx);
    expect(outcome.kind).toBe("ok");
    expect(outcome.store.bookmarks).toEqual([]);
    expect(outcome.warnings[0]).toContain("is unreadable");
    const [name, content] = [...io.backups.entries()][0]!;
    expect(name).toMatch(/^data\.corrupt-/);
    expect(content).toBe('{"version": 1, "bookmarks": [');
  });

  it("invalid structure: backup and start over", async () => {
    const io = new MemoryIO(JSON.stringify(["non", "un", "oggetto"]));
    const outcome = await loadStore(io, ctx);
    expect(outcome.store.bookmarks).toEqual([]);
    expect([...io.backups.keys()][0]).toMatch(/^data\.corrupt-/);
  });

  it("single invalid entries are dropped, the others kept", async () => {
    const { store } = storeWith([
      { filePath: LINUX, name: "Buono", text: LESSON, marker: "ip rule" },
    ]);
    const raw = { ...store, bookmarks: [...store.bookmarks, { id: "rotto", name: 42 }] };
    const io = new MemoryIO(JSON.stringify(raw));
    const outcome = await loadStore(io, ctx);
    expect(outcome.store.bookmarks.map((b) => b.name)).toEqual(["Buono"]);
    expect(outcome.warnings[0]).toContain("1 invalid entries");
    expect([...io.backups.keys()][0]).toMatch(/^data\.backup-invalid-/);
  });
});

describe("merging with changes from another device", () => {
  const base = () =>
    storeWith([
      { filePath: LINUX, name: "A", text: LESSON, marker: "ip rule" },
      { filePath: LINUX, name: "B", text: LESSON, marker: "kernel" },
    ]);

  it("keeps bookmarks created elsewhere and local ones", () => {
    const { store: local } = base();
    const { store: remoteOnly } = storeWith([
      { filePath: "Cloud/x.md", name: "R", text: LESSON, marker: "kernel" },
    ]);
    const remote = {
      ...remoteOnly,
      bookmarks: remoteOnly.bookmarks.map((b) => ({ ...b, id: "remote-1" })),
    };
    const merged = mergeStores(local, remote, { settingsFrom: "local", now: T2 });
    expect(merged.bookmarks.map((b) => b.name)).toEqual(["A", "B", "R"]);
  });

  it("for the same bookmark the most recent revision wins", () => {
    const { store, bookmarks } = base();
    const remote = renameBookmark(store, bookmarks[0]!.id, "Rinominato altrove", T2);
    const local = renameBookmark(store, bookmarks[0]!.id, "Rinominato qui", T1);
    const merged = mergeStores(local, remote, { settingsFrom: "local", now: T2 });
    expect(merged.bookmarks[0]!.name).toBe("Rinominato altrove");
  });

  it("a local automatic fix does not undo an update made elsewhere", () => {
    const { store, bookmarks } = base();
    const id = bookmarks[0]!.id;
    const remote = updateBookmarkPosition(store, id, "Linux/nuovo.md", bookmarks[1]!.position, T1);
    const local = markDeletedPath(
      healBookmarkPosition(store, id, bookmarks[0]!.position, T2),
      LINUX,
      T2,
    );
    const merged = mergeStores(local, remote, { settingsFrom: "local", now: T2 });
    expect(merged.bookmarks.find((b) => b.id === id)).toMatchObject({
      filePath: "Linux/nuovo.md",
      status: "ok",
    });
  });

  it("a bookmark deleted elsewhere does not come back", () => {
    const { store, bookmarks } = base();
    const remote = deleteBookmark(store, bookmarks[1]!.id, T1);
    const merged = mergeStores(store, remote, { settingsFrom: "local", now: T2 });
    expect(merged.bookmarks.map((b) => b.name)).toEqual(["A"]);
    expect(merged.tombstones).toHaveLength(1);
  });

  it("old tombstones are pruned", () => {
    const { store } = base();
    const old = { ...store, tombstones: [{ id: "x", deletedAt: "2020-01-01T00:00:00.000Z" }] };
    expect(mergeStores(old, store, { settingsFrom: "local", now: T2 }).tombstones).toEqual([]);
  });

  it("readRemote reports a corrupt file without throwing", async () => {
    const io = new MemoryIO("{rotto");
    const result = await readRemote(io, ctx);
    expect(result.kind).toBe("corrupt");
    expect(io.backups.size).toBe(1);
  });
});
