import { describe, expect, it } from "vitest";
import { filterBookmarks, parseQuery } from "../src/view/filter";
import {
  collectGroupKeys,
  dateBucket,
  groupBookmarks,
  topFolderOf,
  type GroupNode,
} from "../src/view/grouping";
import { LESSON, T0, T1, T2, storeWith } from "./helpers";

const { store } = storeWith([
  {
    filePath: "Linux/modulo00/lezione01/lesson.md",
    name: "Da riprendere",
    text: LESSON,
    marker: "ip rule",
    now: T0,
  },
  {
    filePath: "Linux/modulo00/lezione01/lesson.md",
    name: "Concetto importante",
    text: LESSON,
    marker: "kernel",
    now: T1,
  },
  {
    filePath: "Linux/modulo00/lezione02/lesson.md",
    name: "Policy routing",
    text: LESSON,
    marker: "basate",
    now: T1,
  },
  {
    filePath: "Networking/modulo01/lezione02/lesson.md",
    name: "Da verificare",
    text: LESSON,
    marker: "table 100",
    now: T2,
  },
  {
    filePath: "Cloud/modulo00/lezione01/lesson.md",
    name: "Esempio pratico",
    text: LESSON,
    marker: "default via",
    now: T2,
  },
]);
const all = store.bookmarks;

function outline(node: GroupNode, depth = 0): string[] {
  const pad = "  ".repeat(depth);
  return [
    ...node.children.flatMap((c) => [`${pad}${c.label} (${c.count})`, ...outline(c, depth + 1)]),
    ...node.bookmarks.map((b) => `${pad}- ${b.name}`),
  ];
}

describe("raggruppamento", () => {
  it("per percorso (albero), con ordinamento naturale delle cartelle", () => {
    expect(outline(groupBookmarks(all, "pathTree", "manual"))).toEqual([
      "Cloud (1)",
      "  modulo00 (1)",
      "    lezione01 (1)",
      "      lesson.md (1)",
      "        - Esempio pratico",
      "Linux (3)",
      "  modulo00 (3)",
      "    lezione01 (2)",
      "      lesson.md (2)",
      "        - Da riprendere",
      "        - Concetto importante",
      "    lezione02 (1)",
      "      lesson.md (1)",
      "        - Policy routing",
      "Networking (1)",
      "  modulo01 (1)",
      "    lezione02 (1)",
      "      lesson.md (1)",
      "        - Da verificare",
    ]);
  });

  it("per percorso (piatto)", () => {
    const root = groupBookmarks(all, "pathFlat", "name");
    expect(root.children.map((c) => c.label)).toEqual([
      "Cloud / modulo00 / lezione01 / lesson.md",
      "Linux / modulo00 / lezione01 / lesson.md",
      "Linux / modulo00 / lezione02 / lesson.md",
      "Networking / modulo01 / lezione02 / lesson.md",
    ]);
    expect(root.children[1]!.bookmarks.map((b) => b.name)).toEqual([
      "Concetto importante",
      "Da riprendere",
    ]);
  });

  it("per cartella principale, nome file, nessuno", () => {
    expect(
      groupBookmarks(all, "topFolder", "manual").children.map((c) => `${c.label}:${c.count}`),
    ).toEqual(["Cloud:1", "Linux:3", "Networking:1"]);
    expect(
      groupBookmarks(all, "fileName", "manual").children.map((c) => `${c.label}:${c.count}`),
    ).toEqual(["lesson.md:5"]);
    const none = groupBookmarks(all, "none", "updated");
    expect(none.children).toEqual([]);
    expect(none.count).toBe(5);
    expect(none.bookmarks[0]!.updatedAt).toBe(T2);
  });

  it("per data di modifica", () => {
    const now = new Date("2026-01-03T18:00:00.000Z");
    expect(dateBucket(T2, now)).toBe("today");
    expect(dateBucket(T1, now)).toBe("yesterday");
    const root = groupBookmarks(all, "modifiedDate", "manual", now);
    expect(root.children.map((c) => `${c.label}:${c.count}`)).toEqual([
      "Oggi:2",
      "Ieri:2",
      "Ultimi 7 giorni:1",
    ]);
  });

  it("raccoglie tutte le chiavi dei gruppi", () => {
    const keys = collectGroupKeys(groupBookmarks(all, "pathTree", "manual"));
    expect(keys).toContain("tree:Linux/modulo00/lezione01");
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("ricerca", () => {
  it("query vuota restituisce tutto", () => {
    expect(filterBookmarks(all, "  ")).toHaveLength(5);
  });

  it("testo libero su nome, percorso e anteprima, senza accenti/maiuscole", () => {
    expect(filterBookmarks(all, "networking").map((b) => b.name)).toEqual(["Da verificare"]);
    expect(filterBookmarks(all, "IMPORTANTE").map((b) => b.name)).toEqual(["Concetto importante"]);
    expect(filterBookmarks(all, "kernel").map((b) => b.name)).toEqual(["Concetto importante"]);
  });

  it("filtri per nome e percorso", () => {
    expect(parseQuery('name:"da ri" path:linux')).toEqual({
      text: [],
      name: ["da ri"],
      path: ["linux"],
    });
    expect(filterBookmarks(all, "name:da path:linux").map((b) => b.name)).toEqual([
      "Da riprendere",
    ]);
    expect(filterBookmarks(all, "path:lezione02").map((b) => b.name)).toEqual([
      "Policy routing",
      "Da verificare",
    ]);
    expect(filterBookmarks(all, "name:inesistente")).toEqual([]);
  });
});

describe("ramo principale", () => {
  it("restituisce la cartella di primo livello", () => {
    expect(topFolderOf("Linux/modulo00/lesson.md")).toBe("Linux");
    expect(topFolderOf("lesson.md")).toBe("");
  });
});

describe("ricerca nelle note", () => {
  it("trova i bookmark per testo della nota", () => {
    const { bookmarks } = storeWith([
      { filePath: "a.md", name: "uno", text: LESSON, marker: "ip rule" },
    ]);
    const withNote = { ...bookmarks[0]!, note: "Ripassare prima dell'esame" };
    expect(filterBookmarks([withNote], "esame")).toHaveLength(1);
    expect(filterBookmarks(bookmarks, "esame")).toHaveLength(0);
  });
});
