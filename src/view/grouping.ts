import type { GroupingMode, LessonBookmark, SortMode } from "../types";

export interface GroupNode {
  /** Chiave stabile, usata per ricordare i gruppi compressi. */
  readonly key: string;
  readonly label: string;
  readonly kind: "root" | "folder" | "file" | "bucket";
  readonly children: readonly GroupNode[];
  readonly bookmarks: readonly LessonBookmark[];
  /** Numero di bookmark in questo gruppo e nei sottogruppi. */
  readonly count: number;
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

export function fileNameOf(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

export function baseNameOf(path: string): string {
  const name = fileNameOf(path);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
}

export function folderOf(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? "" : path.slice(0, slash);
}

/** Cartella di primo livello ("ramo principale"); stringa vuota per i file nella radice. */
export function topFolderOf(path: string): string {
  const slash = path.indexOf("/");
  return slash === -1 ? "" : path.slice(0, slash);
}

export const ROOT_FOLDER_LABEL = "(radice del vault)";

export function sortBookmarks(
  bookmarks: readonly LessonBookmark[],
  mode: SortMode,
): LessonBookmark[] {
  const sorted = [...bookmarks];
  switch (mode) {
    case "manual":
      return sorted.sort((a, b) => a.order - b.order || a.createdAt.localeCompare(b.createdAt));
    case "name":
      return sorted.sort(
        (a, b) => collator.compare(a.name, b.name) || collator.compare(a.filePath, b.filePath),
      );
    case "file":
      return sorted.sort(
        (a, b) => collator.compare(a.filePath, b.filePath) || a.position.offset - b.position.offset,
      );
    case "updated":
      return sorted.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
}

interface MutableNode {
  key: string;
  label: string;
  kind: GroupNode["kind"];
  children: Map<string, MutableNode>;
  bookmarks: LessonBookmark[];
}

function node(key: string, label: string, kind: GroupNode["kind"]): MutableNode {
  return { key, label, kind, children: new Map(), bookmarks: [] };
}

function child(
  parent: MutableNode,
  key: string,
  label: string,
  kind: GroupNode["kind"],
): MutableNode {
  const existing = parent.children.get(key);
  if (existing) return existing;
  const created = node(key, label, kind);
  parent.children.set(key, created);
  return created;
}

function freeze(n: MutableNode, sort: SortMode, childOrder?: readonly string[]): GroupNode {
  const values = [...n.children.values()];
  const ordered = childOrder
    ? childOrder.map((k) => n.children.get(k)).filter((c): c is MutableNode => c !== undefined)
    : values.sort((a, b) => {
        // Le cartelle prima dei file, come nell'esplora file di Obsidian.
        if (a.kind !== b.kind) return a.kind === "folder" ? -1 : 1;
        return collator.compare(a.label, b.label);
      });
  const children = ordered.map((c) => freeze(c, sort));
  const bookmarks = sortBookmarks(n.bookmarks, sort);
  const count = bookmarks.length + children.reduce((sum, c) => sum + c.count, 0);
  return { key: n.key, label: n.label, kind: n.kind, children, bookmarks, count };
}

type DateBucket = "today" | "yesterday" | "week" | "month" | "older";

const BUCKET_LABELS: Record<DateBucket, string> = {
  today: "Oggi",
  yesterday: "Ieri",
  week: "Ultimi 7 giorni",
  month: "Ultimi 30 giorni",
  older: "Più vecchi",
};
const BUCKET_ORDER: readonly DateBucket[] = ["today", "yesterday", "week", "month", "older"];

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

export function dateBucket(iso: string, now: Date): DateBucket {
  const today = startOfDay(now);
  const day = startOfDay(new Date(iso));
  const diffDays = Math.round((today - day) / 86_400_000);
  if (diffDays <= 0) return "today";
  if (diffDays === 1) return "yesterday";
  if (diffDays < 7) return "week";
  if (diffDays < 30) return "month";
  return "older";
}

/** Costruisce l'albero dei gruppi mostrato nella sidebar. */
export function groupBookmarks(
  bookmarks: readonly LessonBookmark[],
  mode: GroupingMode,
  sort: SortMode,
  now: Date = new Date(),
): GroupNode {
  const root = node("", "", "root");

  switch (mode) {
    case "none":
      root.bookmarks.push(...bookmarks);
      return freeze(root, sort);

    case "topFolder":
      for (const b of bookmarks) {
        const top = topFolderOf(b.filePath);
        child(root, `top:${top}`, top || ROOT_FOLDER_LABEL, "folder").bookmarks.push(b);
      }
      return freeze(root, sort);

    case "pathTree":
      for (const b of bookmarks) {
        const segments = b.filePath.split("/");
        const file = segments.pop() as string;
        let current = root;
        let prefix = "";
        for (const segment of segments) {
          prefix = prefix ? `${prefix}/${segment}` : segment;
          current = child(current, `tree:${prefix}`, segment, "folder");
        }
        child(current, `tree:${b.filePath}`, file, "file").bookmarks.push(b);
      }
      return freeze(root, sort);

    case "pathFlat":
      for (const b of bookmarks) {
        child(root, `flat:${b.filePath}`, b.filePath.split("/").join(" / "), "file").bookmarks.push(
          b,
        );
      }
      return freeze(root, sort);

    case "fileName":
      for (const b of bookmarks) {
        const name = fileNameOf(b.filePath);
        child(root, `name:${name}`, name, "file").bookmarks.push(b);
      }
      return freeze(root, sort);

    case "modifiedDate": {
      for (const b of bookmarks) {
        const bucket = dateBucket(b.updatedAt, now);
        child(root, `date:${bucket}`, BUCKET_LABELS[bucket], "bucket").bookmarks.push(b);
      }
      return freeze(
        root,
        sort,
        BUCKET_ORDER.map((b) => `date:${b}`),
      );
    }
  }
}

/** Tutte le chiavi dei gruppi (per espandi/comprimi tutto). */
export function collectGroupKeys(root: GroupNode): string[] {
  return root.children.flatMap((c) => [c.key, ...collectGroupKeys(c)]);
}
