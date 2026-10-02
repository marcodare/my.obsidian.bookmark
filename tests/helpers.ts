import { capturePosition } from "../src/anchor/capture";
import { createBookmark } from "../src/store/operations";
import type { DataIO } from "../src/store/persistence";
import { createEmptyStore, type BookmarkStore, type LessonBookmark } from "../src/types";

export const T0 = "2026-01-01T10:00:00.000Z";
export const T1 = "2026-01-02T10:00:00.000Z";
export const T2 = "2026-01-03T10:00:00.000Z";

export function idFactory(prefix = "id"): () => string {
  let n = 0;
  return () => `${prefix}-${++n}`;
}

/** Offset subito dopo la prima occorrenza di `marker`. */
export function offsetAfter(text: string, marker: string): number {
  const index = text.indexOf(marker);
  if (index === -1) throw new Error(`marker "${marker}" non trovato`);
  return index + marker.length;
}

export function storeWith(
  entries: readonly {
    filePath: string;
    name: string;
    text: string;
    marker: string;
    now?: string;
  }[],
): { store: BookmarkStore; bookmarks: LessonBookmark[] } {
  const newId = idFactory("bm");
  let store = createEmptyStore();
  const bookmarks: LessonBookmark[] = [];
  for (const e of entries) {
    const position = capturePosition(e.text, offsetAfter(e.text, e.marker), "editor");
    const created = createBookmark(
      store,
      { filePath: e.filePath, name: e.name, position },
      e.now ?? T0,
      newId(),
    );
    store = created.store;
    bookmarks.push(created.bookmark);
  }
  return { store, bookmarks };
}

/** DataIO in memoria che simula data.json e i file di backup. */
export class MemoryIO implements DataIO {
  raw: string | null;
  readonly backups = new Map<string, string>();
  saves = 0;

  constructor(raw: string | null = null) {
    this.raw = raw;
  }

  async load(): Promise<unknown> {
    return this.raw === null ? null : JSON.parse(this.raw);
  }

  async save(store: BookmarkStore): Promise<void> {
    this.saves++;
    this.raw = JSON.stringify(store);
  }

  async readRaw(): Promise<string | null> {
    return this.raw;
  }

  async writeBackup(fileName: string, content: string): Promise<void> {
    this.backups.set(fileName, content);
  }
}

export const LESSON = `---
tags: [linux]
---
# Routing

Il routing statico usa la tabella principale del kernel.

## Policy routing

Con ip rule si possono definire regole basate sulla sorgente del pacchetto.
Le tabelle aggiuntive si dichiarano in /etc/iproute2/rt_tables.

## Esempio pratico

ip rule add from 10.0.0.0/24 table 100
ip route add default via 192.168.1.1 table 100
`;
