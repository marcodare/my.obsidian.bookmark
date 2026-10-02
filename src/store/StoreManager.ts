import type { BookmarkStore } from "../types";
import { createEmptyStore } from "../types";
import type { MigrationContext } from "./migrations";
import { loadStore, mergeStores, readRemote, type DataIO } from "./persistence";

export interface StoreManagerOptions {
  readonly io: DataIO;
  readonly clock: () => string;
  readonly newId: () => string;
  /** Messaggio leggibile da mostrare all'utente. */
  readonly notify: (message: string) => void;
}

type Listener = (store: BookmarkStore) => void;

/**
 * Stato in memoria + scrittura prudente di data.json.
 * Ogni scrittura rilegge il file, unisce le modifiche arrivate da altri dispositivi e poi salva.
 * Le scritture sono serializzate in coda.
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
   * Applica una modifica e la salva. Restituisce false se lo store è in sola lettura.
   * Con `debounceMs` il salvataggio viene posticipato e accorpato (es. tracciamento delle modifiche).
   */
  update(mutator: (store: BookmarkStore) => BookmarkStore, debounceMs = 0): boolean {
    if (this.readOnly) {
      this.options.notify(
        "My Obsidian Bookmark è in sola lettura: data.json proviene da una versione più recente.",
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

  /** Salva subito, accodandosi alle scritture in corso. */
  persist(): Promise<void> {
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    this.queue = this.queue
      .then(() => this.writeMerged())
      .catch((error: unknown) => {
        this.options.notify(`Errore nel salvataggio dei bookmark: ${describe(error)}`);
      });
    return this.queue;
  }

  private async writeMerged(): Promise<void> {
    if (this.readOnly) return;
    const ctx = this.ctx();
    const remote = await readRemote(this.options.io, ctx);
    switch (remote.kind) {
      case "ok": {
        // `this.current` è letto dopo l'await: include le modifiche fatte nel frattempo.
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
          `data.json è stato aggiornato al formato v${remote.version} da un altro dispositivo. ` +
            "Aggiorna My Obsidian Bookmark: le modifiche sono sospese.",
        );
        return;
      case "corrupt":
        this.options.notify(
          `data.json era danneggiato; copia salvata in ${remote.backup}. Riscritto con i dati in memoria.`,
        );
        break;
      case "missing":
        break;
    }
    await this.options.io.save(this.current);
  }

  /** data.json è stato modificato dall'esterno (sync): unisce e aggiorna la vista. */
  async reloadFromDisk(): Promise<void> {
    this.queue = this.queue
      .then(async () => {
        const ctx = this.ctx();
        const remote = await readRemote(this.options.io, ctx);
        if (remote.kind === "newer") {
          this.readOnly = true;
          this.options.notify(
            "data.json proviene da una versione più recente del plugin: modifiche sospese.",
          );
          return;
        }
        if (remote.kind !== "ok") return;
        const merged = mergeStores(this.current, remote.store, {
          settingsFrom: "remote",
          now: ctx.now,
        });
        this.current = merged;
        this.emit();
        // Riscrive solo se qui c'erano modifiche non ancora presenti sul disco.
        if (JSON.stringify(merged) !== JSON.stringify(remote.store))
          await this.options.io.save(merged);
      })
      .catch((error: unknown) => {
        this.options.notify(`Errore nel ricaricare i bookmark: ${describe(error)}`);
      });
    return this.queue;
  }

  /** Salva le modifiche in sospeso (alla chiusura del plugin). */
  async flush(): Promise<void> {
    if (this.debounceTimer !== null) await this.persist();
    else await this.queue;
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
