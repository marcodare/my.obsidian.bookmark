import type { BookmarkStore } from "../types";
import { createEmptyStore } from "../types";
import type { MigrationContext } from "./migrations";
import { loadStore, mergeStores, readRemote, type DataIO } from "./persistence";

export interface StoreManagerOptions {
  readonly io: DataIO;
  readonly clock: () => string;
  readonly newId: () => string;
  /** Human-readable message to show the user. */
  readonly notify: (message: string) => void;
}

type Listener = (store: BookmarkStore) => void;

/**
 * In-memory state + careful writes of data.json.
 * Every write re-reads the file, merges changes from other devices, then saves.
 * Writes are serialized in a queue.
 */
export class StoreManager {
  private current: BookmarkStore = createEmptyStore();
  private readOnly = false;
  private queue: Promise<void> = Promise.resolve();
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly listeners = new Set<Listener>();

  constructor(private readonly options: StoreManagerOptions) {}

  get store(): BookmarkStore {
    return this.current;
  }

  get isReadOnly(): boolean {
    return this.readOnly;
  }

  private ctx(): MigrationContext {
    return { now: this.options.clock(), newId: this.options.newId };
  }

  async load(): Promise<void> {
    const outcome = await loadStore(this.options.io, this.ctx());
    this.current = outcome.store;
    this.readOnly = outcome.kind === "readOnly";
    outcome.warnings.forEach((w) => this.options.notify(w));
    this.emit();
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    this.listeners.forEach((l) => l(this.current));
  }

  /**
   * Applies a change and saves it. Returns false when the store is read-only.
   * With `debounceMs` the save is delayed and batched (e.g. edit tracking).
   */
  update(mutator: (store: BookmarkStore) => BookmarkStore, debounceMs = 0): boolean {
    if (this.readOnly) {
      this.options.notify(
        "My Obsidian Bookmark is read-only: data.json comes from a newer version.",
      );
      return false;
    }
    const next = mutator(this.current);
    if (next === this.current) return true;
    this.current = next;
    this.emit();
    if (debounceMs > 0) this.schedulePersist(debounceMs);
    else void this.persist();
    return true;
  }

  private schedulePersist(delayMs: number): void {
    if (this.debounceTimer !== null) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      void this.persist();
    }, delayMs);
  }

  /** Saves now, queued after writes in progress. */
  persist(): Promise<void> {
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    this.queue = this.queue
      .then(() => this.writeMerged())
      .catch((error: unknown) => {
        this.options.notify(`Failed to save bookmarks: ${describe(error)}`);
      });
    return this.queue;
  }

  private async writeMerged(): Promise<void> {
    if (this.readOnly) return;
    const ctx = this.ctx();
    const remote = await readRemote(this.options.io, ctx);
    switch (remote.kind) {
      case "ok": {
        // `this.current` is read after the await: it includes changes made meanwhile.
        const merged = mergeStores(this.current, remote.store, {
          settingsFrom: "local",
          now: ctx.now,
        });
        const changed = JSON.stringify(merged.bookmarks) !== JSON.stringify(this.current.bookmarks);
        this.current = merged;
        if (changed) this.emit();
        break;
      }
      case "newer":
        this.readOnly = true;
        this.options.notify(
          `data.json was upgraded to format v${remote.version} by another device. ` +
            "Update My Obsidian Bookmark: editing is paused.",
        );
        return;
      case "corrupt":
        this.options.notify(
          `data.json was corrupt; copy saved to ${remote.backup}. Rewritten from the in-memory data.`,
        );
        break;
      case "missing":
        break;
    }
    await this.options.io.save(this.current);
  }

  /** data.json was changed externally (sync): merges and refreshes the view. */
  async reloadFromDisk(): Promise<void> {
    this.queue = this.queue
      .then(async () => {
        const ctx = this.ctx();
        const remote = await readRemote(this.options.io, ctx);
        if (remote.kind === "newer") {
          this.readOnly = true;
          this.options.notify("data.json comes from a newer plugin version: editing is paused.");
          return;
        }
        if (remote.kind !== "ok") return;
        const merged = mergeStores(this.current, remote.store, {
          settingsFrom: "remote",
          now: ctx.now,
        });
        this.current = merged;
        this.emit();
        // Rewrites only if there were local changes not yet on disk.
        if (JSON.stringify(merged) !== JSON.stringify(remote.store))
          await this.options.io.save(merged);
      })
      .catch((error: unknown) => {
        this.options.notify(`Failed to reload bookmarks: ${describe(error)}`);
      });
    return this.queue;
  }

  /** Saves pending changes (when the plugin unloads). */
  async flush(): Promise<void> {
    if (this.debounceTimer !== null) await this.persist();
    else await this.queue;
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
